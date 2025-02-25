/* eslint-disable global-require, import/no-dynamic-require */
import fs from 'fs';
import path from 'path';
import semver from 'semver';

import Config from '../config';
import { executeAsync } from '../systemTools/exec';
import {
    writeObjectSync,
    copyFileSync,
    updateObjectSync
} from '../systemTools/fileutils';
import { logError } from '../systemTools/logger';

const bumpVersions = (version) => {
    const {
        project: { dir },
        rnv: { pluginTemplates }
    } = Config.getConfig().paths;
    // check for packages to bump
    const packagesDir = path.join(dir, 'packages');
    if (fs.existsSync(packagesDir)) {
        const packages = fs.readdirSync(packagesDir);
        packages.forEach((name) => {
            const pkgPath = path.join(packagesDir, name);
            const pkgJsonPath = path.join(pkgPath, 'package.json');
            if (
                fs.lstatSync(pkgPath).isDirectory()
                && fs.existsSync(pkgJsonPath)
            ) {
                // we found a packaaaage, fist-bumpin' it
                const existingPkgJson = require(pkgJsonPath);
                existingPkgJson.version = version;
                writeObjectSync(pkgJsonPath, existingPkgJson);
            }
        });
        // check if it's our turf and do some extra magic
        const renativePkgPath = path.join(packagesDir, 'renative');
        if (fs.existsSync(renativePkgPath)) {
            copyFileSync(
                path.join(dir, 'README.md'),
                path.join(renativePkgPath, 'README.md')
            );
            updateObjectSync(pluginTemplates.config, {
                pluginTemplates: {
                    renative: {
                        version
                    }
                }
            });
        }
    }
};

const publishAll = () => {
    const {
        project: { dir }
    } = Config.getConfig().paths;
    const packagesDir = path.join(dir, 'packages');
    if (fs.existsSync(packagesDir)) {
        const packages = fs.readdirSync(packagesDir);
        return Promise.all(
            packages.map((name) => {
                const pkgPath = path.join(packagesDir, name);
                return executeAsync('npm i', { cwd: pkgPath });
            })
        );
    }
    return true;
};

const rnvPkg = async () => {
    let args = [...Config.getConfig().program.rawArgs];
    args = args.slice(3);

    const firstArg = args[0];
    const secondArg = args[1];

    switch (firstArg) {
        case 'version':
            // sets the given version to all of the packages, if there are any
            if (!secondArg) { return logError('No version specified', false, true); }
            if (!semver.valid(secondArg)) {
                return logError(
                    `Invalid version specified ${secondArg}`,
                    false,
                    true
                );
            }
            return bumpVersions(secondArg);
        case 'publish':
            return publishAll();
        default:
            logError(`Unknown argument ${firstArg}`, false, true);
            break;
    }
};

export default rnvPkg;
