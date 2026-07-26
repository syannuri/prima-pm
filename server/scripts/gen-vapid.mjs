// Generate a Web-Push (VAPID) keypair and append it to server/.env if not already present.
// Idempotent — safe to run more than once. Run from the server/ directory:
//
//   node scripts/gen-vapid.mjs [subject]
//
// `subject` defaults to https://prismatix.tech (a mailto: or https URL identifying the sender).
// After it writes the keys, restart the service so they take effect:  sudo systemctl restart prima-pm
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error(`No .env found in ${process.cwd()} — run this from the server/ directory.`);
  process.exit(1);
}

const env = fs.readFileSync(envPath, 'utf8');
if (/^VAPID_PUBLIC_KEY=/m.test(env)) {
  console.log('VAPID keys are already set in .env — nothing to do.');
  process.exit(0);
}

const subject = process.argv[2] || 'https://prismatix.tech';
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const block = `\n# Web-push (VAPID) — generated ${new Date().toISOString().slice(0, 10)}\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${subject}\n`;
fs.appendFileSync(envPath, block);

console.log('✅ VAPID keys generated and appended to server/.env');
console.log('   Public key:', publicKey);
console.log('   (private key was written to .env, not shown)');
console.log('\nNow restart the service:  sudo systemctl restart prima-pm');
