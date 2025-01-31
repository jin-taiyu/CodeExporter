import * as vscode from 'vscode';
import { FileExplorerProvider, FileNode } from './treeDataProvider';
import { MarkdownGenerator } from './markdownGenerator';

export function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showInformationMessage('Please open a workspace first to use Code Exporter');
        return;
    }

    // Initialize providers
    const fileExplorerProvider = new FileExplorerProvider(workspaceRoot);
    const markdownGenerator = new MarkdownGenerator(workspaceRoot);
    let statusBarItem: vscode.StatusBarItem;

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(export) Export Code";
    statusBarItem.command = 'codeExporter.export';
    statusBarItem.tooltip = "Export selected files to Markdown";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register Tree View
    const treeView = vscode.window.createTreeView('codeExporterTree', {
        treeDataProvider: fileExplorerProvider,
        showCollapseAll: true,
        canSelectMany: false
    });

    // Register Commands
    const commands = [
        vscode.commands.registerCommand('codeExporter.refresh', () => {
            fileExplorerProvider.refresh();
        }),

        vscode.commands.registerCommand('codeExporter.selectAll', () => {
            fileExplorerProvider.selectAll();
        }),

        vscode.commands.registerCommand('codeExporter.deselectAll', () => {
            fileExplorerProvider.deselectAll();
        }),

        vscode.commands.registerCommand('codeExporter.export', async () => {
            const selectedNodes = fileExplorerProvider.getSelectedNodes();
            if (selectedNodes.length === 0) {
                vscode.window.showWarningMessage('Please select at least one file or directory to export');
                return;
            }

            try {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Exporting code...",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0 });
                    const markdown = await markdownGenerator.generateMarkdown(selectedNodes);
                    progress.report({ increment: 50 });
                    const config = vscode.workspace.getConfiguration('codeExporter');
                    const defaultPath = config.get<string>('outputPath', '');
                    await markdownGenerator.saveMarkdown(markdown, defaultPath);
                    progress.report({ increment: 100 });
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Export failed: ${error}`);
            }
        }),

        vscode.commands.registerCommand('codeExporter.getChildren', async (node: FileNode) => {
            const children = await fileExplorerProvider.getChildren(node);
            return children;
        }),

        vscode.commands.registerCommand('codeExporter.itemClick', (node: FileNode) => {
            if (node) {
                // If it's a directory, handle expand/collapse
                if (node.isDirectory) {
                    const currentState = node.collapsibleState;
                    if (currentState === vscode.TreeItemCollapsibleState.Collapsed) {
                        treeView.reveal(node, { expand: true });
                    }
                }
                // Toggle selection state regardless of directory/file
                fileExplorerProvider.toggleSelection(node);
            }
        })
    ];

    context.subscriptions.push(treeView, ...commands);
}

export function deactivate() {
    // Cleanup if needed
}
