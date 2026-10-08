import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT || 8080);

createApp()
  .then((app) => {
    app.listen(port, () => {
      console.log(`Gateway listening on http://localhost:${port}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Failed to start the server:', err);
    process.exit(1);
  });
