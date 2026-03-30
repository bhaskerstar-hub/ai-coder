import * as vscode from 'vscode';
import { registerChatParticipant } from './providers/chatParticipant';
import { registerInlineCompletionProvider } from './providers/inlineCompletion';
import { registerLanguageModelProvider } from './providers/languageModelProvider';
import { registerTools } from './agent/tools';
import { getIndexer } from './context/indexer';
import { getConfig } from './config/settings';
import { listOllamaModels, formatModelSize } from './providers/ollamaDiscovery';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('AI Coder');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('AI Coder extension activating...');

  registerChatParticipant(context);
  outputChannel.appendLine('Chat participant registered');

  registerLanguageModelProvider(context);
  outputChannel.appendLine('Language model provider registered');

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

  // Select Model command — QuickPick with live Ollama model discovery
  context.subscriptions.push(
    vscode.commands.registerCommand('aiCoder.selectModel', async () => {
      const models = await listOllamaModels(true);

      if (models.length === 0) {
        const action = await vscode.window.showWarningMessage(
          'AI Coder: No Ollama models found. Is Ollama running?',
          'Open Settings'
        );
        if (action === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'aiCoder.ollama');
        }
        return;
      }

      const config = getConfig();
      const items: vscode.QuickPickItem[] = models.map((m) => ({
        label: m.name,
        description: formatModelSize(m.size),
        detail: m.name === config.ollama.chatModel ? '$(check) Current chat model' : undefined,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'AI Coder: Select Ollama Model',
        placeHolder: `Current: ${config.ollama.chatModel}`,
      });

      if (picked) {
        await vscode.workspace.getConfiguration('aiCoder').update(
          'ollama.chatModel',
          picked.label,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(`AI Coder: Chat model set to ${picked.label}`);
      }
    })
  );

  // Status bar — click opens model selector
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const config = getConfig();
  statusBarItem.text = `$(sparkle) AI Coder (${config.ollama.chatModel})`;
  statusBarItem.tooltip = 'AI Coder — Click to select model';
  statusBarItem.command = 'aiCoder.selectModel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiCoder')) {
        const updated = getConfig();
        statusBarItem.text = `$(sparkle) AI Coder (${updated.ollama.chatModel})`;
      }
    })
  );

  outputChannel.appendLine('AI Coder extension activated successfully');
}

export function deactivate(): void {
  // cleanup handled by disposables
}
