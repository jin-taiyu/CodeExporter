import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class FileNode extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public isSelected: boolean = false
    ) {
        super(resourceUri, collapsibleState);
        this.contextValue = this.isDirectory ? 'directory' : (isSelected ? 'selected' : 'unselected');
        this.label = path.basename(resourceUri.fsPath);
        this.description = this.isDirectory ? '' : path.extname(resourceUri.fsPath).slice(1);
        this.tooltip = this.resourceUri.fsPath;
        this.command = {
            command: 'codeExporter.itemClick',
            title: 'Select Item',
            arguments: [this]
        };
        this.updateIcon();
    }

    get isDirectory(): boolean {
        return this.collapsibleState !== vscode.TreeItemCollapsibleState.None;
    }

    private updateIcon() {
        const iconName = this.isSelected ? 'checkbox-checked.svg' : 'checkbox-unchecked.svg';
        const iconPath = path.join(__filename, '..', '..', 'media', iconName);
        this.iconPath = {
            light: vscode.Uri.file(iconPath),
            dark: vscode.Uri.file(iconPath)
        };
    }

    public toggleSelection() {
        this.isSelected = !this.isSelected;
        this.contextValue = this.isSelected ? 'selected' : 'unselected';
        this.updateIcon();
    }
}

interface FileInfo {
    path: string;
    isDirectory: boolean;
    children?: FileInfo[];
}

export class FileExplorerProvider implements vscode.TreeDataProvider<FileNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileNode | undefined | null | void> = new vscode.EventEmitter<FileNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private selectedNodes: Map<string, FileNode> = new Map();
    private searchPattern: string = '';
    private _onDidChangeHasSearchResults = new vscode.EventEmitter<boolean>();
    readonly onDidChangeHasSearchResults = this._onDidChangeHasSearchResults.event;
    private fileStructure: Map<string, FileInfo> = new Map();

    constructor(private workspaceRoot: string | undefined) {}

    setSearchPattern(pattern: string) {
        this.searchPattern = pattern;
        this.fileStructure.clear();
        if (pattern.startsWith('*.')) {
            this.buildFileStructure(this.workspaceRoot);
        }
        this.refresh();
    }

    private matchesPattern(filePath: string): boolean {
        if (!this.searchPattern || !this.searchPattern.startsWith('*.')) {
            return false;
        }

        const extension = path.extname(filePath);
        return extension === this.searchPattern.slice(1);
    }

    private async buildFileStructure(rootPath: string | undefined): Promise<void> {
        if (!rootPath) {
            return;
        }

        try {
            const files = await fs.promises.readdir(rootPath);
            
            for (const file of files) {
                const filePath = path.join(rootPath, file);
                const stat = await fs.promises.stat(filePath);

                // Skip hidden files and excluded patterns
                const config = vscode.workspace.getConfiguration('codeExporter');
                const includeHidden = config.get<boolean>('includeHidden', false);
                const excludePattern = config.get<string>('excludePattern', '**/node_modules/**,**/.git/**');
                const exclude = excludePattern.split(',');

                if ((!includeHidden && file.startsWith('.')) || 
                    exclude.some(pattern => {
                        const normalizedPattern = pattern.trim();
                        return filePath.includes(normalizedPattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, ''));
                    })) {
                    continue;
                }

                const fileInfo: FileInfo = {
                    path: filePath,
                    isDirectory: stat.isDirectory(),
                    children: []
                };

                if (stat.isDirectory()) {
                    await this.buildFileStructure(filePath);
                } else if (this.matchesPattern(filePath)) {
                    // If the file matches, create and select the node
                    const uri = vscode.Uri.file(filePath);
                    const node = new FileNode(uri, vscode.TreeItemCollapsibleState.None, true);
                    this.selectedNodes.set(filePath, node);
                }

                this.fileStructure.set(filePath, fileInfo);
            }

            this._onDidChangeHasSearchResults.fire(this.selectedNodes.size > 0);
        } catch (error) {
            vscode.window.showErrorMessage(`Error building file structure: ${error}`);
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileNode): Thenable<FileNode[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No workspace folder is opened');
            return Promise.resolve([]);
        }

        if (element) {
            return this.getFiles(element.resourceUri.fsPath);
        } else {
            return this.getFiles(this.workspaceRoot);
        }
    }

    private async getFiles(folderPath: string): Promise<FileNode[]> {
        if (!fs.existsSync(folderPath)) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('codeExporter');
        const includeHidden = config.get<boolean>('includeHidden', false);
        const excludePattern = config.get<string>('excludePattern', '**/node_modules/**,**/.git/**');
        const exclude = excludePattern.split(',');

        try {
            const files = await fs.promises.readdir(folderPath);
            const nodes: FileNode[] = [];

            for (const file of files) {
                const filePath = path.join(folderPath, file);
                const stat = await fs.promises.stat(filePath);

                // Skip hidden files if not included
                if (!includeHidden && file.startsWith('.')) {
                    continue;
                }

                // Skip excluded patterns
                if (exclude.some(pattern => {
                    const normalizedPattern = pattern.trim();
                    return filePath.includes(normalizedPattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, ''));
                })) {
                    continue;
                }

                const uri = vscode.Uri.file(filePath);
                const isSelected = this.selectedNodes.has(filePath);
                const node = new FileNode(
                    uri,
                    stat.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    isSelected
                );
                
                if (isSelected) {
                    this.selectedNodes.set(filePath, node);
                }
                
                nodes.push(node);
            }

            return nodes.sort((a, b) => {
                if (a.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed && 
                    b.collapsibleState === vscode.TreeItemCollapsibleState.None) {
                    return -1;
                }
                if (a.collapsibleState === vscode.TreeItemCollapsibleState.None && 
                    b.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                    return 1;
                }
                return a.label?.toString().localeCompare(b.label?.toString() || '') || 0;
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading directory: ${error}`);
            return [];
        }
    }

    toggleSelection(node: FileNode): void {
        node.toggleSelection();
        const filePath = node.resourceUri.fsPath;
        
        if (node.isSelected) {
            this.selectedNodes.set(filePath, node);
        } else {
            this.selectedNodes.delete(filePath);
        }
        
        this._onDidChangeTreeData.fire(node);
    }

    getSelectedNodes(): FileNode[] {
        return Array.from(this.selectedNodes.values()).sort((a, b) => {
            return a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath);
        });
    }

    selectAll(): void {
        this.traverseAndSelect(this.workspaceRoot, true);
        this._onDidChangeTreeData.fire();
    }

    deselectAll(): void {
        this.selectedNodes.clear();
        this.traverseAndSelect(this.workspaceRoot, false);
        this._onDidChangeTreeData.fire();
    }

    private async traverseAndSelect(rootPath: string | undefined, select: boolean): Promise<void> {
        if (!rootPath) {
            return;
        }

        const nodes = await this.getFiles(rootPath);
        for (const node of nodes) {
            const filePath = node.resourceUri.fsPath;
            node.isSelected = select;
            node.toggleSelection();
            
            if (select) {
                this.selectedNodes.set(filePath, node);
            } else {
                this.selectedNodes.delete(filePath);
            }

            if (node.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                await this.traverseAndSelect(filePath, select);
            }
        }
    }

    hasMatchedFiles(): boolean {
        return this.selectedNodes.size > 0;
    }
}
