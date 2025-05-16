/**
 * server/qr-api-server.js
 *
 * Dependencies:
 *   npm install express
 *
 * File layout:
 *   /project
 *     upgrade-firmware.sh      ← your firmware build script
 *     /server
 *       qr-api-server.js        ← this file
 *     /arduino
 *       /farm_hub_node/
 *         Settings.h            ← will be patched
 *       /ndk_node/
 *         Settings.h            ← will be patched
 */

const express = require('express');
const fs      = require('fs').promises;
const path    = require('path');
const { exec } = require('child_process');
const util    = require('util');

const execAsync = util.promisify(exec);

const app        = express();
const serverPort = 3000;

// Absolute paths to Settings.h files and upgrade script
const farmHubSettings = path.resolve(__dirname, '../arduino/farm_hub_node/Settings.h');
const ndkSettings     = path.resolve(__dirname, '../arduino/ndk_node/Settings.h');
const upgradeScript   = path.resolve(__dirname, './upgrade-firmware.sh');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function updateSettings(filePath, netId) {
  let content = await fs.readFile(filePath, 'utf8');
  const defineLine = `#define LORA_NET_ID ${netId}`;
  content = content.replace(
    /^#define\s+LORA_NET_ID\s+\S+/m,
    defineLine
  );
  await fs.writeFile(filePath, content, 'utf8');
  console.log(`✅ Updated ${path.basename(filePath)} → ${defineLine}`);
}

app.get('/trigger', async (req, res) => {
  const netId  = req.query.data;
  const portId = req.query.port;

  // Validate netId as 8-bit hex integer (e.g. 0x00–0xFF)
  if (!netId || !/^0x[0-9A-Fa-f]{1,2}$/.test(netId)) {
    return res
      .status(400)
      .json({ error: 'Parameter "data" must be a hex byte, e.g. 0x21.' });
  }

  try {
    // Patch both Settings.h files
    await updateSettings(farmHubSettings, netId);
    await updateSettings(ndkSettings,     netId);

    // Build upgrade commands (portId optional)
    let cmdFarm = `${upgradeScript} ./arduino/farm_hub_node/`;
    let cmdNdk  = `${upgradeScript} ./arduino/ndk_node/`;
    if (portId) {
      cmdFarm += ` ${portId}`;
      cmdNdk  += ` ${portId}`;
    }

    // Run upgrade for farm_hub_node
    console.log(`🔨 Running: ${cmdFarm}`);
    const resultFarm = await execAsync(cmdFarm);
    console.log('📦 farm_hub_node stdout:', resultFarm.stdout);
    if (resultFarm.stderr) console.error('⚠ farm_hub_node stderr:', resultFarm.stderr);

    // Run upgrade for ndk_node
    console.log(`🔨 Running: ${cmdNdk}`);
    const resultNdk = await execAsync(cmdNdk);
    console.log('📦 ndk_node stdout:', resultNdk.stdout);
    if (resultNdk.stderr) console.error('⚠ ndk_node stderr:', resultNdk.stderr);

    // Build response
    const response = { status: 'ok', newNetId: netId };
    if (portId) response.port = portId;
    res.json(response);
  } catch (err) {
    console.error('❌ Error in /trigger:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(serverPort, () => {
  console.log(`⚡ QR-API server listening on http://localhost:${serverPort}`);
});
