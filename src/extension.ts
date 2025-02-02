import * as vscode from 'vscode';
import * as path from 'path';
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

    // Create search box
    let searchBox: vscode.InputBox;
    const createSearchBox = () => {
        searchBox = vscode.window.createInputBox();
        searchBox.placeholder = "Enter file type (e.g., *.py for Python files)";
        searchBox.prompt = "Type *.ext pattern to match files";
        searchBox.onDidChangeValue(value => {
            if (value.startsWith('*.')) {
                fileExplorerProvider.setSearchPattern(value);
            }
        });
        searchBox.onDidAccept(() => {
            searchBox.hide();
        });
        searchBox.onDidHide(() => {
            if (!searchBox.value) {
                fileExplorerProvider.setSearchPattern('');
            }
        });
        return searchBox;
    };

    // Register Commands
    const commands = [
        vscode.commands.registerCommand('codeExporter.searchFiles', () => {
            if (!searchBox) {
                searchBox = createSearchBox();
            }
            searchBox.show();
        }),

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
                    fileExplorerProvider.deselectAll();
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Export failed: ${error}`);
            }
        }),

        vscode.commands.registerCommand('codeExporter.getChildren', async (node: FileNode) => {
            const children = await fileExplorerProvider.getChildren(node);
            return children;
        }),

        vscode.commands.registerCommand('codeExporter.preview', async (node: FileNode) => {
            if (!node || node.isDirectory) {
                return;
            }
            
            try {
                const document = await vscode.workspace.openTextDocument(node.resourceUri);
                await vscode.window.showTextDocument(document, {
                    preview: true,
                    preserveFocus: true,
                    viewColumn: vscode.ViewColumn.One
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error previewing file: ${error}`);
            }
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
        }),

        // Show in File Explorer
        vscode.commands.registerCommand('codeExporter.showInExplorer', (node: FileNode) => {
            if (node) {
                vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            }
        }),

        // Copy Absolute Path
        vscode.commands.registerCommand('codeExporter.copyAbsolutePath', (node: FileNode) => {
            if (node) {
                vscode.env.clipboard.writeText(node.resourceUri.fsPath);
                vscode.window.showInformationMessage('Absolute path copied to clipboard');
            }
        }),

        // Copy Relative Path
        vscode.commands.registerCommand('codeExporter.copyRelativePath', (node: FileNode) => {
            if (node && workspaceRoot) {
                const relativePath = path.relative(workspaceRoot, node.resourceUri.fsPath);
                vscode.env.clipboard.writeText(relativePath);
                vscode.window.showInformationMessage('Relative path copied to clipboard');
            }
        })
    ];

    // Listen for search results changes
    fileExplorerProvider.onDidChangeHasSearchResults(hasResults => {
        vscode.commands.executeCommand('setContext', 'codeExporter:hasSearchResults', hasResults);
    });

    context.subscriptions.push(treeView, ...commands);
}

export function deactivate() {
    // Cleanup if needed
}
