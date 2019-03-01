import path from 'path';
import fs from 'fs';
import { executeAsync } from '../exec';
import {
    isPlatformSupported, getConfig, logTask, logComplete, logError,
    getAppFolder, isPlatformActive, logDebug,
} from '../common';
import { cleanFolder, copyFolderContentsRecursiveSync, copyFolderRecursiveSync, copyFileSync, mkdirSync } from '../fileutils';

const runPod = (command, cwd) => new Promise((resolve, reject) => {
    logTask(`runPod:${command}`);

    if (!fs.existsSync(cwd)) {
        logError(`Location ${cwd} does not exists!`);
        resolve();
        return;
    }

    return executeAsync('pod', [
        command,
    ], {
        cwd,
        evn: process.env,
        stdio: 'inherit',
    }).then(() => resolve())
        .catch((e) => {
            logError(e);
            resolve();
        });
});

const copyAppleAssets = (c, platform, appFolderName) => new Promise((resolve, reject) => {
    logTask('copyAppleAssets');
    if (!isPlatformActive(c, platform, resolve)) return;

    const iosPath = path.join(getAppFolder(c, platform), appFolderName);
    const sPath = path.join(c.appConfigFolder, `assets/${platform}`);
    copyFolderContentsRecursiveSync(sPath, iosPath);
    resolve();
});

const configureXcodeProject = (c, platform, appFolderName) => new Promise((resolve, reject) => {
    logTask('configureXcodeProject');
    if (!isPlatformActive(c, platform, resolve)) return;

    const appFolder = getAppFolder(c, platform);

    fs.writeFileSync(path.join(appFolder, 'main.jsbundle'), '{}');
    mkdirSync(path.join(appFolder, 'assets'));
    mkdirSync(path.join(appFolder, `${appFolderName}/images`));

    resolve();
});

const runXcodeProject = (c, platform, deviceName) => new Promise((resolve, reject) => {
    logTask('runXcodeProject');
    const device = c.program.target || deviceName;
    const appPath = getAppFolder(c, platform);
    const p = [
        'run-ios',
        '--project-path',
        appPath,
        '--simulator',
        device,
        '--scheme',
        c.appConfigFile.platforms[platform].scheme,
        '--configuration',
        c.appConfigFile.platforms[platform].runScheme,
    ];
    logDebug('running', p);
    if (c.appConfigFile.platforms[platform].runScheme === 'Release') {
        // iosPackage(buildConfig).then(v => executeAsync('react-native', p));
    } else {
        executeAsync('react-native', p).then(() => resolve()).catch(e => reject(e));
    }
});

export { runPod, copyAppleAssets, configureXcodeProject, runXcodeProject };
