import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileNode } from './treeDataProvider';

export class MarkdownGenerator {
    constructor(private readonly workspaceRoot: string) {}

    private getLanguageIdentifier(filePath: string): string {
        const config = vscode.workspace.getConfiguration('codeExporter');
        const languageMap = config.get<Record<string, string>>('defaultLanguageMap', {});
        const ext = path.extname(filePath).toLowerCase();
        return languageMap[ext] || 'plaintext';
    }

    private async getAllFilesInDirectory(dirPath: string, excludePattern: string): Promise<string[]> {
        const files: string[] = [];
        const exclude = excludePattern.split(',').map(p => p.trim());

        async function traverse(currentPath: string) {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                
                // Check if path should be excluded
                if (exclude.some(pattern => 
                    fullPath.includes(pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '')))) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await traverse(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        }

        await traverse(dirPath);
        return files;
    }

    private async generateDirectoryTree(nodes: FileNode[], prefix: string = ''): Promise<string> {
        let tree = '';
        const sortedNodes = [...nodes].sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.label?.toString().localeCompare(b.label?.toString() || '') || 0;
        });

        for (let i = 0; i < sortedNodes.length; i++) {
            const node = sortedNodes[i];
            const isLast = i === sortedNodes.length - 1;
            const marker = isLast ? '└── ' : '├── ';
            const indent = prefix.replace('├── ', '│   ').replace('└── ', '    ');
            
            tree += `${prefix}${marker}${node.label}\n`;

            if (node.isDirectory) {
                const childNodes = await vscode.commands.executeCommand<FileNode[]>(
                    'codeExporter.getChildren',
                    node
                );
                if (childNodes && childNodes.length > 0) {
                    tree += await this.generateDirectoryTree(
                        childNodes,
                        prefix + (isLast ? '    ' : '│   ')
                    );
                }
            }
        }
        return tree;
    }

    private async readFileContent(filePath: string): Promise<string> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return content.trimEnd();
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading file ${filePath}: ${error}`);
            return '';
        }
    }

    public async generateMarkdown(selectedNodes: FileNode[]): Promise<string> {
        let markdown = '### Relative Code\n\n';
        const config = vscode.workspace.getConfiguration('codeExporter');
        const excludePattern = config.get<string>('excludePattern', '**/node_modules/**,**/.git/**');

        // Collect all files to process
        const filesToProcess = new Set<string>();
        for (const node of selectedNodes) {
            if (node.isDirectory) {
                const files = await this.getAllFilesInDirectory(node.resourceUri.fsPath, excludePattern);
                files.forEach(file => filesToProcess.add(file));
            } else {
                filesToProcess.add(node.resourceUri.fsPath);
            }
        }

        // Add tree structure
        markdown += '#### Relative Directory Structure\n\n```\n';
        markdown += this.workspaceRoot + '\n';
        markdown += await this.generateDirectoryTree(selectedNodes);
        markdown += '```\n\n';

        // Add file contents
        markdown += '#### File Contents\n\n';
        for (const filePath of filesToProcess) {
            const relativePath = path.relative(this.workspaceRoot, filePath);
            const language = this.getLanguageIdentifier(filePath);
            const content = await this.readFileContent(filePath);

            markdown += `##### ${relativePath}\n\n`;
            markdown += '```' + language + '\n';
            markdown += content + '\n';
            markdown += '```\n\n';
        }

        return markdown;
    }

    public async saveMarkdown(content: string, defaultPath?: string): Promise<void> {
        try {
            const defaultUri = defaultPath
                ? vscode.Uri.file(defaultPath)
                : vscode.Uri.file(path.join(this.workspaceRoot, 'exported-code.md'));

            const uri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: {
                    'Markdown': ['md']
                }
            });

            if (uri) {
                await fs.promises.writeFile(uri.fsPath, content);
                vscode.window.showInformationMessage(`Successfully exported to ${uri.fsPath}`);
                
                // Open the exported file in VS Code
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error saving markdown: ${error}`);
        }
    }
}
