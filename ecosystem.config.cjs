// Processi PM2 di Vigil. Il sito e il worker sono separati:
// se il sito si riavvia, i ping continuano a essere registrati.
const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: "vigil",
      cwd,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3110",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
    },
    {
      name: "vigil-pinger",
      cwd,
      script: "worker/pinger.mjs",
      env: { NODE_ENV: "production" },
      max_memory_restart: "220M",
    },
  ],
};
