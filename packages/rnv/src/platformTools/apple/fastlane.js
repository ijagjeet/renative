import path from 'path';
import chalk from 'chalk';
import { getConfigProp, getAppId } from '../../common';
import { logTask, logWarning, logSuccess } from '../../systemTools/logger';
import { executeAsync } from '../../systemTools/exec';
import { IOS, TVOS } from '../../constants';
import { setAppConfig } from '../../configTools/configParser';

export const registerDevice = async (c) => {
    logTask(`registerDevice:${c.platform}`);

    const teamID = getConfigProp(c, c.platform, 'teamID');
    const udid = c.runtime.targetUDID;
    const deviceName = c.runtime.target;

    const args = [
        'run',
        'register_device',
        `team_id:"${teamID}"`,
        `udid:"${udid}"`,
        `name:"${deviceName}"`
    ];

    try {
        await executeAsync(c, `fastlane ${args.join(' ')}`, {
            shell: true,
            stdio: 'inherit',
            silent: true
        });
        logSuccess(
            `Succesfully registered device ${deviceName}:${udid}:${teamID}`
        );
        return true;
    } catch (e) {
        logWarning(e);
        return true;
    }
};

export const updateProfile = async (c, appConfigId) => {
    logTask(`updateProfile:${appConfigId}`, chalk.grey);

    // TODO: run trough all schemes
    // const schemes = c.buildConfig.platforms?.[c.platform]?.buildSchemes
    // const currScheme = c.program.scheme
    // for(k in schemes) {
    //   c.program.scheme = k
    // }

    if (appConfigId) await setAppConfig(c, appConfigId);

    if (c.platform !== IOS && c.platform !== TVOS) {
        return Promise.reject(
            `updateProfile:platform ${c.platform} not supported`
        );
    }
    const { scheme } = c.program;

    const { platform } = c;

    const { appId } = c.runtime;

    const id = getAppId(c, platform);
    const teamID = getConfigProp(c, platform, 'teamID');
    const pMethod = getConfigProp(c, platform, 'exportOptions')?.method;
    const runScheme = getConfigProp(c, platform, 'runScheme');
    let provisioning;
    if (pMethod === 'ad-hoc') provisioning = 'adhoc';
    if (pMethod === 'development' || runScheme === 'Debug') { provisioning = 'development'; }

    const certsPath = path.join(c.paths.workspace.appConfig.dir, 'certs');

    let args = [
        'sigh',
        '--app_identifier',
        id,
        '--team_id',
        teamID,
        '--output_path',
        certsPath,
        '--force',
        '--platform',
        platform
    ];
    if (process.env.APPLE_DEVELOPER_USERNAME) {
        args = args.concat([
            '--username',
            process.env.APPLE_DEVELOPER_USERNAME
        ]);
    }
    if (provisioning) {
        args.push(`--${provisioning}`);
    }

    try {
        await executeAsync(c, `fastlane ${args.join(' ')}`, {
            shell: true,
            stdio: 'inherit',
            silent: true
        });
        logSuccess(
            `Succesfully updated provisioning profile for ${appId}:${scheme}:${id}`
        );
        return true;
    } catch (e) {
        logWarning(e);
        return true;
    }
};
