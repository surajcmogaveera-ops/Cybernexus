import 'dotenv/config';
import { app } from './app.js';

const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, () => console.log(`CyberNexus API listening on port ${port}`));
