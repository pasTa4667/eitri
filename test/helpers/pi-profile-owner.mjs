import { withDedicatedProfile } from '../../prototypes/pi-profile.mjs';
await withDedicatedProfile(process.argv[2], async () => {
  process.send('owned');
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
});
