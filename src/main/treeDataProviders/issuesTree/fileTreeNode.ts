import * as vscode from 'vscode';

import { Severity, SeverityUtils } from '../../types/severity';
import { Utils } from '../utils/utils';
import { IssuesRootTreeNode } from './issuesRootTreeNode';
import { IssueTreeNode } from './issueTreeNode';

export interface Region {
    start: vscode.Position;
    end: vscode.Position;
}

/**
 * Describes any type of file with Xray issues for the 'Issues' view.
 * This base class should be extended to hold a specific/subset type/s of issues
 */
export abstract class FileTreeNode extends vscode.TreeItem {
    protected _severity: Severity = Severity.Unknown;
    private _name: string;

    constructor(private _fullPath: string, private _parent?: IssuesRootTreeNode, private _timeStamp?: number) {
        super(_fullPath);
        this._name = Utils.getLastSegment(_fullPath);
        this.label = this._name;
    }

    /**
     * Return all the issues in this file
     */
    public abstract get issues(): IssueTreeNode[];

    /**
     * Search for file issue base on id
     * @param id - id of an issue
     * @returns the issue node if exists in file, undefined otherwise
     */
    public getIssueById(id: string): IssueTreeNode | undefined {
        return this.issues.find(issue => id == issue.issueId);
    }

    /**
     * Apply all the changes to this object and its children, This method should be called after evrey set of changes to this object or its children.
     * Use to calculate accumulative statistics and view from all the children.
     */
    public apply() {
        // If no description is set, show the full path of the file or the relative path base on the path of the parent workspace if exists
        if (this.description == undefined) {
            let description: string | undefined = this._fullPath;
            if (this._parent && this._fullPath.startsWith(this._parent.workSpace.uri.fsPath)) {
                let localPath: string = this._fullPath.substring(this._parent.workSpace.uri.fsPath.length + 1);
                if (localPath !== this.name) {
                    description = './' + localPath;
                } else {
                    description = undefined;
                }
            }
            this.description = description;
        }

        // Set collapsible state base on children count
        if (this.issues.length == 0) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        } else {
            if (this.issues.length == 1 && this.parent?.children.length == 1) {
                this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            } else {
                this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            }
        }

        // Caclulate the tooltip information
        this.tooltip = 'Top severity: ' + SeverityUtils.getString(this.severity) + '\n';
        this.tooltip += 'Issues count: ' + this.issues.length + '\n';
        this.tooltip += 'Full path: ' + this.fullPath;
        if (this.timeStamp) {
            this.tooltip += '\nLast ' + Utils.getLastScanString(this.timeStamp);
        }
    }

    /**
     * Create a file node to represent an error occur during the scanning of the file.
     * @param fullPath - the path of the file that the error occur during its scan
     * @param reason - the reason the file failed. Will we added to the title of the file to show the user
     * @returns a new file node for the failed file
     */
    public static createFailedScanNode(fullPath: string, reason?: string): FileTreeNode {
        const node: FileTreeNode = new (class extends FileTreeNode {
            constructor(fullPath: string, parent?: IssuesRootTreeNode, timeStamp?: number) {
                super(fullPath, parent, timeStamp);
            }
            /** @override */
            public get issues(): IssueTreeNode[] {
                return [];
            }
        })(fullPath);

        node.name += reason ? ' - ' + reason : '';
        node.description = 'Fail to scan file';
        node.tooltip = fullPath;
        node._severity = Severity.Unknown;
        return node;
    }

    public get name(): string {
        return this._name;
    }

    public set name(value: string) {
        this._name = value;
        this.label = this._name;
    }

    public get timeStamp(): number | undefined {
        return this._timeStamp;
    }

    public set timeStamp(value: number | undefined) {
        this._timeStamp = value;
    }

    public get parent(): IssuesRootTreeNode | undefined {
        return this._parent;
    }

    public set parent(value: IssuesRootTreeNode | undefined) {
        this._parent = value;
    }

    public get severity(): Severity {
        return this._severity;
    }

    public set severity(value: Severity | undefined) {
        this._severity = value ?? Severity.Unknown;
    }

    public get fullPath(): string {
        return this._fullPath;
    }

    public set fullPath(value: string) {
        this._fullPath = value;
    }
}
