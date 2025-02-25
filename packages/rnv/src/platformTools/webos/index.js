/* eslint-disable import/no-cycle */
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import semver from 'semver';
import inquirer from 'inquirer';
import { executeAsync, execCLI, openCommand } from '../../systemTools/exec';
import {
    getAppFolder,
    getAppVersion,
    getAppTitle,
    writeCleanFile,
    getAppId,
    getAppTemplateFolder,
    getConfigProp,
    waitForEmulator,
    waitForWebpack,
    checkPortInUse,
    confirmActiveBundler
} from '../../common';
import { isPlatformActive } from '..';
import {
    logToSummary,
    logTask,
    logInfo,
    logSuccess
} from '../../systemTools/logger';
import {
    copyBuildsFolder,
    copyAssetsFolder
} from '../../projectTools/projectParser';
import {
    CLI_WEBOS_ARES_PACKAGE,
    CLI_WEBOS_ARES_INSTALL,
    CLI_WEBOS_ARES_DEVICE_INFO,
    CLI_WEBOS_ARES_LAUNCH,
    CLI_WEBOS_ARES_NOVACOM,
    CLI_WEBOS_ARES_SETUP_DEVICE
} from '../../constants';
import { getRealPath } from '../../systemTools/fileutils';
import { buildWeb, configureCoreWebProject } from '../web';
import { rnvStart } from '../runner';
import Config from '../../config';
import { isSystemWin } from '../../utils';

const launchWebOSimulator = (c) => {
    logTask('launchWebOSimulator');

    const ePath = path.join(
        getRealPath(c, c.files.workspace.config.sdks.WEBOS_SDK),
        `Emulator/v4.0.0/LG_webOS_TV_Emulator${
            isSystemWin ? '.exe' : '_RCU.app'
        }`
    );

    if (!fs.existsSync(ePath)) {
        return Promise.reject(`Can't find emulator at path: ${ePath}`);
    }
    if (isSystemWin) { return executeAsync(c, ePath, { detached: true, stdio: 'ignore' }); }
    return executeAsync(c, `${openCommand} ${ePath}`, { detached: true });
};

const startHostedServerIfRequired = (c) => {
    if (Config.isWebHostEnabled) {
        return rnvStart(c);
    }
};

const parseDevices = (c, devicesResponse) => {
    const linesArray = devicesResponse
        .split('\n')
        .slice(2)
        .map(line => line.trim())
        .filter(line => line !== '');
    return Promise.all(
        linesArray.map(async (line) => {
            const [name, device, connection, profile] = line
                .split(' ')
                .map(word => word.trim())
                .filter(word => word !== '');
            let deviceInfo = '';
            try {
                deviceInfo = await execCLI(
                    c,
                    CLI_WEBOS_ARES_DEVICE_INFO,
                    `-d ${name}`,
                    { silent: true, timeout: 10000 }
                );
            } catch (e) {
                deviceInfo = e;
            }

            return {
                name,
                device,
                connection,
                profile,
                isDevice: !device.includes(c.runtime.localhost),
                active: !deviceInfo.includes('ERR!')
            };
        })
    );
};

const installAndLaunchApp = async (c, target, appPath, tId) => {
    try {
        await execCLI(
            c,
            CLI_WEBOS_ARES_INSTALL,
            `--device ${target} ${appPath}`
        );
    } catch (e) {
        // installing it again if it fails. For some reason webosCLI says that it can't connect to
        // the device from time to time. Running it again works.
        await execCLI(
            c,
            CLI_WEBOS_ARES_INSTALL,
            `--device ${target} ${appPath}`
        );
    }
    const { hosted } = c.program;
    const { platform } = c;
    const isHosted = hosted || !getConfigProp(c, platform, 'bundleAssets');
    let toReturn = true;
    if (isHosted) {
        toReturn = startHostedServerIfRequired(c);
        await waitForWebpack(c);
    }
    await execCLI(c, CLI_WEBOS_ARES_LAUNCH, `--device ${target} ${tId}`);
    return toReturn;
};

const buildDeviceChoices = devices => devices.map(device => ({
    key: device.name,
    name: `${device.name} - ${device.device}`,
    value: device.name
}));

const listWebOSTargets = async (c) => {
    const devicesResponse = await execCLI(c, CLI_WEBOS_ARES_DEVICE_INFO, '-D');
    const devices = await parseDevices(c, devicesResponse);

    const deviceArray = devices.map(
        (device, i) => ` [${i + 1}]> ${chalk.bold(device.name)} | ${device.device}`
    );

    logToSummary(`WebOS Targets:\n${deviceArray.join('\n')}`);

    return true;
};

const waitForEmulatorToBeReady = async (c) => {
    const devicesResponse = await execCLI(c, CLI_WEBOS_ARES_DEVICE_INFO, '-D');
    const devices = await parseDevices(c, devicesResponse);
    const emulator = devices.filter(d => !d.isDevice)[0];
    if (!emulator) throw new Error('No WebOS emulator configured');

    return waitForEmulator(
        c,
        CLI_WEBOS_ARES_DEVICE_INFO,
        `-d ${emulator.name}`,
        res => res.includes('modelName')
    );
};

const runWebOS = async (c, platform, target) => {
    logTask(`runWebOS:${platform}:${target}`);

    const { device, hosted } = c.program;

    const isHosted = hosted || !getConfigProp(c, platform, 'bundleAssets');

    const tDir = path.join(getAppFolder(c, platform), 'public');
    const tOut = path.join(getAppFolder(c, platform), 'output');
    const tSim = c.program.target || 'emulator';
    const configFilePath = path.join(
        getAppFolder(c, platform),
        'public/appinfo.json'
    );

    logTask(`runWebOS:${platform}:${target}:${isHosted}`, chalk.grey);

    const cnfg = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
    const tId = cnfg.id;
    const appPath = path.join(tOut, `${tId}_${cnfg.version}_all.ipk`);

    if (isHosted) {
        const isPortActive = await checkPortInUse(c, platform, c.runtime.port);
        if (isPortActive) {
            await confirmActiveBundler(c);
            c.runtime.skipActiveServerCheck = true;
        }
    }

    // Start the fun
    !isHosted && (await buildWeb(c, platform));
    await execCLI(c, CLI_WEBOS_ARES_PACKAGE, `-o ${tOut} ${tDir} -n`);

    // List all devices
    const devicesResponse = await execCLI(c, CLI_WEBOS_ARES_DEVICE_INFO, '-D');
    const devices = await parseDevices(c, devicesResponse);
    const activeDevices = devices.filter(d => d.active);

    if (device) {
        // Running on a device
        const actualDevices = devices.filter(d => d.isDevice);

        if (!actualDevices.length) {
            // No device configured. Asking to configure
            const response = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'setupDevice',
                    message:
                        'Looks like you want to deploy on a device but have none configured. Do you want to configure one?',
                    default: false
                }
            ]);

            if (response.setupDevice) {
                // Yes, I would like that
                logInfo(
                    'Please follow the instructions from http://webostv.developer.lge.com/develop/app-test/#installDevModeApp on how to setup the TV and the connection with the PC. Then follow the onscreen prompts\n'
                );
                await execCLI(c, CLI_WEBOS_ARES_SETUP_DEVICE, '', {
                    interactive: true
                });

                const newDeviceResponse = await execCLI(
                    c,
                    CLI_WEBOS_ARES_DEVICE_INFO,
                    '-D'
                );
                const dev = await parseDevices(c, newDeviceResponse);
                const actualDev = dev.filter(d => d.isDevice);

                if (actualDev.length > 0) {
                    const newDevice = actualDev[0];
                    // Oh boy, oh boy, I did it! I have a TV connected!
                    logInfo(
                        "Please enter the `Passphrase` from the TV's Developer Mode app"
                    );
                    await execCLI(
                        c,
                        CLI_WEBOS_ARES_NOVACOM,
                        `--device ${newDevice.name} --getkey`,
                        { stdio: 'inherit' }
                    );
                    return installAndLaunchApp(c, newDevice.name, appPath, tId);
                }
                // Yes, I said I would but I didn't
                // @todo handle user not setting up the device
            }
        } else if (actualDevices.length === 1) {
            const tv = actualDevices[0];
            return installAndLaunchApp(c, tv.name, appPath, tId);
        }
    } else if (!c.program.target) {
        // No target specified
        if (activeDevices.length === 1) {
            // One device present
            return installAndLaunchApp(c, devices[0].name, appPath, tId);
        }
        if (activeDevices.length > 1) {
            // More than one, choosing
            const choices = buildDeviceChoices(devices);
            const response = await inquirer.prompt([
                {
                    name: 'chosenDevice',
                    type: 'list',
                    message: 'What device would you like to start the app?',
                    choices
                }
            ]);
            if (response.chosenDevice) {
                return installAndLaunchApp(
                    c,
                    response.chosenDevice,
                    appPath,
                    tId
                );
            }
        } else {
            await launchWebOSimulator(c);
            await waitForEmulatorToBeReady(c);
            return installAndLaunchApp(c, tSim, appPath, tId);
        }
    } else {
        // Target specified, using that
        return installAndLaunchApp(c, c.program.target, appPath, tId);
    }
};

const buildWebOSProject = (c, platform) => new Promise((resolve, reject) => {
    logTask(`buildWebOSProject:${platform}`);

    const tDir = path.join(getAppFolder(c, platform), 'public');
    const tOut = path.join(getAppFolder(c, platform), 'output');

    buildWeb(c, platform)
        .then(() => execCLI(c, CLI_WEBOS_ARES_PACKAGE, `-o ${tOut} ${tDir} -n`))
        .then(() => {
            logSuccess(
                `Your IPK package is located in ${chalk.white(tOut)} .`
            );
            return resolve();
        })
        .catch(reject);
});

const configureWebOSProject = async (c, platform) => {
    logTask('configureWebOSProject');

    if (!isPlatformActive(c, platform)) return;

    await copyAssetsFolder(c, platform);
    await configureCoreWebProject(c, platform);
    await configureProject(c, platform);
    return copyBuildsFolder(c, platform);
};

const configureProject = (c, platform) => new Promise((resolve, reject) => {
    logTask(`configureProject:${platform}`);

    const appFolder = getAppFolder(c, platform);

    const configFile = 'public/appinfo.json';
    writeCleanFile(
        path.join(getAppTemplateFolder(c, platform), configFile),
        path.join(appFolder, configFile),
        [
            {
                pattern: '{{APPLICATION_ID}}',
                override: getAppId(c, platform).toLowerCase()
            },
            {
                pattern: '{{APP_TITLE}}',
                override: getAppTitle(c, platform)
            },
            {
                pattern: '{{APP_VERSION}}',
                override: semver.coerce(getAppVersion(c, platform))
            }
        ]
    );

    resolve();
});

export {
    launchWebOSimulator,
    configureWebOSProject,
    runWebOS,
    buildWebOSProject,
    listWebOSTargets
};
