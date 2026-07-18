const path = require("node:path");
const { getAiConfig, getRuntimeConfig, loadEnvFile } = require("./src/config");

loadEnvFile(path.join(__dirname, ".env"));

const { createAppServer } = require("./src/app");

if (require.main === module) {
  const { port } = getRuntimeConfig();
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`StadiumPulse 26 running at http://localhost:${port}`);
  });
}

module.exports = {
  createAppServer,
  getAiConfig
};
