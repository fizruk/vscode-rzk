import * as vscode from 'vscode';
import semver from 'semver';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { output } from './logging';
import {
  fetchReleaseBinary,
  fetchLatestCompatibleRelease,
  // isCompatibleVersion,
} from './githubReleases';
import { extract } from 'tar';

const binExtension = process.platform === 'win32' ? '.exe' : '';
const binName = 'rzk' + binExtension;

/**
 * Finds the path to rzk on the user's system
 */
function getUserRzkPath() {
  // Check the config variable first, then the PATH
  const path =
    // Using `||` and not `??` to handle empty string (the default value) as well
    vscode.workspace.getConfiguration().get<string>('rzk.path') || 'rzk';
  // TODO: handle reporting errors for the config being set but not pointing to a valid executable
  const result = spawnSync(path, ['version']);
  if (result.status === 0) {
    return path;
  }
  return null;
}

export async function installRzkIfNotExists({
  binFolder,
}: {
  binFolder: vscode.Uri;
}) {
  const path = getUserRzkPath();
  if (path != null) {
    output.appendLine(`Using rzk from "${path === 'rzk' ? 'PATH' : path}"`);
    await checkForUpdates(path);
    return;
  }
  // Create the bin folder (recursively) if it doesn't exist
  await vscode.workspace.fs.createDirectory(binFolder);
  const listing = await vscode.workspace.fs.readDirectory(binFolder);

  /*
  // TODO:
  // This section has been commented out since for now we only have one executable in the binFolder
  //  and don't keep older versions. In the future, a better approach would be to use versions in
  //  file name itself (rather than keeping it as `rzk.exe`)

  // Find the first executable that satisfies the version range the extension supports
  const compatibleBin = listing
    // Only files
    .filter(([_name, type]) => type === vscode.FileType.File)
    // Sort descending (to get latest version first)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .find(([name, _type]) => {
      // TODO: improve the version extraction to use RegEx or something more robust
      // `isCompatibleVersion` uses `semver.coerce` internally, which will extract the version from the string
      return isCompatibleVersion(name);
    });
  */
  const localBin = listing
    .filter(([_name, type]) => type === vscode.FileType.File)
    .find(([name, _type]) => name === binName);
  if (localBin) {
    const path = join(binFolder.fsPath, localBin[0]);
    output.appendLine('Found local installation of rzk: ' + path);
    await checkForUpdates(path, binFolder);
    return;
  }

  // Ignore the returned promise to not block the rest of the code waiting for user input
  void vscode.window
    .showWarningMessage(
      "Cannot find 'rzk' in PATH. Install latest version of rzk from GitHub releases?",
      'Yes',
      'Ignore'
    )
    .then(async (value) => {
      if (value === 'Yes') {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
          },
          (progress) => {
            progress.report({
              message: `Installing rzk...`,
            });
            return installLatestRzk(binFolder, progress);
          }
        );
      }
    });
}

type Progress = Parameters<Parameters<typeof vscode.window.withProgress>[1]>[0];
async function installLatestRzk(binFolder: vscode.Uri, progress?: Progress) {
  output.appendLine('Installing rzk...');
  const release = await fetchLatestCompatibleRelease();
  if (!release) {
    vscode.window.showErrorMessage(
      'An error occurred fetching GitHub releases!'
    );
    return;
  }
  output.appendLine(`Fetched rzk release ${release.tag_name} from GitHub`);
  progress?.report({
    message: `Installing rzk ${release.tag_name}...`,
  });
  const assetBuffer = await fetchReleaseBinary(release);
  if (!assetBuffer) {
    output.appendLine('Failed to fetch release asset');
    return;
  }
  output.appendLine(`Downloaded binary for release ${release.tag_name}`);

  output.appendLine(`Extracting to "${binFolder.path}"`);
  const assetStream = Readable.from(Buffer.from(assetBuffer));
  const tarInputStream = extract({
    cwd: binFolder.fsPath,
  });
  await pipeline(assetStream, tarInputStream);
  output.appendLine('File extracted successfully');
  vscode.window
    .showInformationMessage(
      'Rzk installed successfully. Please reload the window for the changes to take effect',
      'Reload'
    )
    .then((value) => {
      if (value === 'Reload') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
}

async function checkForUpdates(binPath: string, binFolder?: vscode.Uri) {
  output.appendLine('Checking if updates are available');
  const version = spawnSync(binPath, ['version']).stdout.toString();
  const latestRelease = await fetchLatestCompatibleRelease();
  if (latestRelease == null) {
    output.appendLine('Cannot find updates on GitHub');
    return;
  }
  const alreadyLatest = semver.gte(
    semver.coerce(version) ?? '',
    semver.coerce(latestRelease.tag_name) ?? ''
  );
  if (alreadyLatest) {
    output.appendLine('Local rzk version is already the latest available 👍');
    return;
  }
  output.appendLine('An update is available. Prompting the user');
  if (binFolder) {
    vscode.window
      .showWarningMessage(
        `Version v${version} of rzk is installed, but ${latestRelease.tag_name} is available. Would you like to update?`,
        'Yes',
        'No'
      )
      .then(async (value) => {
        if (value === 'Yes') {
          output.appendLine('Updating local rzk version');
          await vscode.window.withProgress(
            {
              title: `Updating rzk (v${version} => ${latestRelease.tag_name})...`,
              location: vscode.ProgressLocation.Notification,
              cancellable: false,
            },
            (progress) => installLatestRzk(binFolder)
          );
        }
      });
  } else {
    // Rzk is not managed by this extension
    vscode.window.showInformationMessage(
      `Version v${version} of rzk is installed, but ${latestRelease.tag_name} is available. Please update your installation of rzk.\nTo have VS Code manage rzk automatically, please remove your rzk build from the PATH`
    );
  }
}

export function clearLocalInstallations(binFolder: vscode.Uri) {
  vscode.workspace.fs
    .delete(vscode.Uri.joinPath(binFolder, binName))
    .then(() =>
      vscode.window.showInformationMessage(
        'Rzk successfully removed from VS Code. Please reload the window',
        'Reload'
      )
    )
    .then((value) => {
      if (value === 'Reload') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
}
