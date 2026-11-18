const config = require('./config');
const { connect } = require('./db');
const app = require('./app');

connect()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Secure Notes running at http://localhost:${config.port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
