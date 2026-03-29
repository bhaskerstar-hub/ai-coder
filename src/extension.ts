import * as vscode from 'vscode';
import { registerChatParticipant } from './providers/chatParticipant';
import { registerInlineCompletionProvider } from './providers/inlineCompletion';
import { registerTools } from './agent/tools';
import { getIndexer } from './context/indexer';
import { getConfig } from './config/settings';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('AI Coder');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('AI Coder extension activating...');

  registerChatParticipant(context);
  outputChannel.appendLine('Chat participant registered');

  registerInlineCompletionProvider(context);
  outputChannel.appendLine('Inline completion provider registered');

  registerTools(context);
  outputChannel.appendLine('Agent tools registered');

  const indexer = getIndexer();
  indexer.initialize(context).then(() => {
    outputChannel.appendLine(`Workspace indexed: ${indexer.getFileCount()} files`);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCoder.openChat', () => {
      vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCoder.inlineEdit', () => {
      vscode.commands.executeCommand('inlineChat.start');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCoder.toggleAutocomplete', () => {
      const config = vscode.workspace.getConfiguration('aiCoder');
      const current = config.get<boolean>('autocomplete.enabled', true);
      config.update('autocomplete.enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `AI Coder Autocomplete: ${!current ? 'Enabled' : 'Disabled'}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiCoder.reindexWorkspace', async () => {
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'AI Coder: Reindexing workspace...' },
        async () => {
          await indexer.buildIndex();
          vscode.window.showInformationMessage(
            `AI Coder: Indexed ${indexer.getFileCount()} files`
          );
        }
      );
    })
  );

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const config = getConfig();
  statusBarItem.text = `$(sparkle) AI Coder (${config.provider})`;
  statusBarItem.tooltip = 'AI Coder - Click to open chat';
  statusBarItem.command = 'aiCoder.openChat';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiCoder')) {
        const updated = getConfig();
        statusBarItem.text = `$(sparkle) AI Coder (${updated.provider})`;
      }
    })
  );

  outputChannel.appendLine('AI Coder extension activated successfully');
}

export function deactivate(): void {
  // cleanup handled by disposables
}
