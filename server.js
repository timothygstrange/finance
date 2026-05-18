const express = require('express');
const path    = require('path');
const app     = express();

const CLIENT_ID     = process.env.MONZO_CLIENT_ID;
const CLIENT_SECRET = process.env.MONZO_CLIENT_SECRET;
const REDIRECT_URI  = process.env.REDIRECT_URI;

let accessToken  = null;
let refreshToken = null;

const CAT_MAP = {
  eating_out:    'Eating out',
  transport:     'Transport',
  shopping:      'Shopping',
  entertainment: 'Entertainment',
  groceries:     'Groceries',
  bills:         'Bills',
  personal_care: 'Personal care',
  holidays:      'Holidays',
  family:        'Family',
  finances:      'Finances',
  general:       'General'
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'familyfinance.html')));

app.get('/auth/monzo', (req, res) => {
  const url = `https://auth.monzo.com/?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=login`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const r = await fetch('https://api.monzo.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        code
      })
    });
    const data = await r.json();
    if (!data.access_token) return res.status(500).send('Auth failed: ' + JSON.stringify(data));
    accessToken  = data.access_token;
    refreshToken = data.refresh_token;
    res.redirect('/');
  } catch (e) {
    res.status(500).send('Auth error: ' + e.message);
  }
});

app.get('/api/status', (req, res) => res.json({ connected: !!accessToken }));

app.get('/api/transactions', async (req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'not_connected' });
  try {
    // Get retail account id
    const acctRes  = await fetch('https://api.monzo.com/accounts', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const acctData = await acctRes.json();
    const account  = acctData.accounts?.find(a => a.type === 'uk_retail');
    if (!account) return res.status(404).json({ error: 'no_retail_account' });

    // Fetch up to 100 transactions per request; loop to get all
    let all = [];
    let before = null;
    for (let i = 0; i < 50; i++) {
      const url = new URL('https://api.monzo.com/transactions');
      url.searchParams.set('account_id', account.id);
      url.searchParams.set('expand[]', 'merchant');
      url.searchParams.set('limit', '100');
      if (before) url.searchParams.set('before', before);

      const txRes  = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const txData = await txRes.json();
      const batch  = txData.transactions || [];
      all = all.concat(batch);
      if (batch.length < 100) break;
      before = batch[0].created; // page backwards
    }

    const transactions = all
      .filter(t => t.amount < 0 && !t.is_load)
      .map(t => ({
        id:   t.id,
        date: t.created.slice(0, 10),
        name: t.merchant?.name || t.description,
        cat:  CAT_MAP[t.category] || 'General',
        amt:  Math.abs(t.amount) / 100
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(transactions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Finance server running on port ${PORT}`));
