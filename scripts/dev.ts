import concurrently from 'concurrently';

const { result } = concurrently(
  [
    { name: 'backend', command: 'npm run dev:backend', prefixColor: 'cyan' },
    { name: 'sandbox', command: 'npm run dev:sandbox-worker', prefixColor: 'magenta' },
    { name: 'web', command: 'npm run dev:web', prefixColor: 'green' },
  ],
  {
    prefix: 'name',
    killOthersOn: ['failure', 'success'],
    restartTries: 0,
  },
);

result.catch(() => {
  process.exit(1);
});
