const { handler } = require('./netlify/functions/quote.js');
(async () => {
  const res = await handler({ httpMethod: 'POST', body: 'not-json' });
  console.log('status', res.statusCode);
  console.log('body', res.body);
})();
