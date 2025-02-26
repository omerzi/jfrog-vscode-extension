import { IUsageFeature } from 'jfrog-client-js';
import Set from 'typescript-collections/dist/lib/Set';
import * as vscode from 'vscode';
import { ScanCacheManager } from '../../cache/scanCacheManager';
import { BuildGeneralInfo, Status } from '../../types/buildGeneralinfo';
import { GeneralInfo } from '../../types/generalInfo';
import { ILicenseKey } from '../../types/licenseKey';
import { Scope } from '../../types/scope';
import { Severity, SeverityUtils } from '../../types/severity';
import { BuildsUtils } from '../../utils/builds/buildsUtils';
import { CiManager } from '../../utils/builds/ciManager';
import { Configuration } from '../../utils/configuration';
import { ScanCancellationError, ScanUtils } from '../../utils/scanUtils';
import { TreesManager } from '../treesManager';
import { Utils } from '../utils/utils';
import { BuildsNode } from './ciNodes/buildsTree';
import { DependenciesTreeNode } from './dependenciesTreeNode';

export class BuildsDataProvider implements vscode.TreeDataProvider<DependenciesTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<DependenciesTreeNode | undefined> = new vscode.EventEmitter<DependenciesTreeNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<DependenciesTreeNode | undefined> = this._onDidChangeTreeData.event;

    private _filteredDependenciesTree: DependenciesTreeNode | undefined;
    protected _dependenciesTree!: DependenciesTreeNode;
    protected _allBuildsTree!: DependenciesTreeNode;
    private _ciInProgress: boolean = false;
    private _filterLicenses: Set<ILicenseKey> = new Set();
    private _filterScopes: Set<Scope> = new Set(scope => scope.label);

    constructor(protected _treesManager: TreesManager, private _scanCacheManager: ScanCacheManager) {}

    public get dependenciesTree() {
        return this._dependenciesTree;
    }

    public get allBuildsTree() {
        return this._allBuildsTree;
    }

    public onChangeFire() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public async stateChange() {
        if (!this.dependenciesTree) {
            this.refresh(false);
            return;
        }
        this.onChangeFire();
    }

    public async refresh(quickScan: boolean) {
        if (this._ciInProgress) {
            vscode.window.showInformationMessage('Loading still in progress...');
            return;
        }
        try {
            this._ciInProgress = true;
            ScanUtils.setScanInProgress(true);
            const credentialsSet: boolean = this._treesManager.connectionManager.areCompleteCredentialsSet();
            this._treesManager.logManager.logMessage('Starting to load builds details...', 'INFO');
            this.sendUsageReport();
            await this.repopulateTree(quickScan, credentialsSet);
            vscode.commands.executeCommand('jfrog.xray.focus');
            this._treesManager.logManager.logMessage('Done loading builds details.', 'INFO');
        } catch (error) {
            if (!(error instanceof ScanCancellationError)) {
                // Unexpected error
                throw error;
            }
            this.clearAllTrees();
            this.onChangeFire();
            vscode.window.showInformationMessage((<any>error).message);
        } finally {
            this._ciInProgress = false;
            ScanUtils.setScanInProgress(false);
        }
    }

    private async sendUsageReport() {
        let featureArray: IUsageFeature[] = [{ featureId: 'ci' }];
        await this._treesManager.connectionManager.sendUsageReport(featureArray);
    }

    public getTreeItem(element: DependenciesTreeNode): vscode.TreeItem {
        element.command = Utils.createNodeCommand('jfrog.xray.focus', '', [element]);
        if (element instanceof BuildsNode) {
            let status: Status = (<BuildGeneralInfo>element.generalInfo).status;
            element.iconPath = BuildsUtils.getIcon(status);
        } else {
            let topSeverity: Severity = element.topSeverity;
            element.iconPath = SeverityUtils.getIcon(topSeverity ? topSeverity : Severity.Normal);
        }
        return element;
    }

    public getChildren(element?: DependenciesTreeNode): Thenable<DependenciesTreeNode[]> {
        if (!this.dependenciesTree) {
            return Promise.resolve([]);
        }
        if (element) {
            return Promise.resolve(element.children);
        }
        let rootChildren: DependenciesTreeNode[] = this._filteredDependenciesTree
            ? this._filteredDependenciesTree.children
            : this.dependenciesTree.children;
        return Promise.resolve(rootChildren);
    }

    public loadBuild(buildGeneralInfo: BuildGeneralInfo) {
        try {
            this.clearDisplayedTree();
            new CiManager(this._treesManager).loadBuildTree(
                buildGeneralInfo.startedTimestamp,
                buildGeneralInfo.artifactId,
                buildGeneralInfo.version,
                this._dependenciesTree
            );
            this.fillFilters(this._dependenciesTree);
            this.onChangeFire();
        } catch (error) {
            this._treesManager.logManager.logError(
                new Error(`Failed to load build '${buildGeneralInfo.artifactId}/${buildGeneralInfo.version}'.`),
                true
            );
        }
    }

    private fillFilters(node: DependenciesTreeNode) {
        for (const child of node.children) {
            this.fillFilters(child);
        }
        this.filterLicenses.union(node.licenses);
        node.generalInfo.scopes.map(scope => this.filterScopes.add(new Scope(scope)));
    }

    public getParent(element: DependenciesTreeNode): Thenable<DependenciesTreeNode | undefined> {
        return Promise.resolve(element.parent);
    }

    public applyFilters(filteredDependenciesTree: DependenciesTreeNode | undefined) {
        this._filteredDependenciesTree = filteredDependenciesTree;
        this.onChangeFire();
    }

    public removeNode(node: DependenciesTreeNode, onChangeFire: () => void) {
        let nodeIndex: number | undefined = node.parent?.children.indexOf(node);
        if (nodeIndex === undefined || nodeIndex < 0) {
            return;
        }
        node.parent?.children.splice(nodeIndex, 1);
        onChangeFire();
    }

    private async repopulateTree(quickScan: boolean, credentialsSet: boolean) {
        await ScanUtils.scanWithProgress(async (progress: vscode.Progress<{ message?: string; increment?: number }>, checkCanceled: () => void) => {
            this.clearAllTrees();
            if (credentialsSet) {
                let allBuilds: DependenciesTreeNode = <DependenciesTreeNode>this.allBuildsTree;
                await new CiManager(this._treesManager, allBuilds).refreshBuilds(progress, checkCanceled);
                this.loadFirstBuild(quickScan);
            }
        }, 'Loading Builds Scans');
    }

    public loadFirstBuild(quickScan: boolean): void {
        if (!!this._allBuildsTree && this._allBuildsTree.children.length > 0) {
            let dependencyTree: DependenciesTreeNode = this._allBuildsTree.children[0];
            let generalInfo: BuildGeneralInfo = <BuildGeneralInfo>dependencyTree.generalInfo;
            this.loadBuild(generalInfo);
        } else {
            this.clearAllTrees();
            this.onChangeFire();
            this._treesManager.logManager.logMessage(
                'Could not find any builds that match the provided pattern: ' + Configuration.getBuildsPattern(),
                'INFO'
            );
            if (!quickScan) {
                vscode.window.showErrorMessage('Search did not find any build that match the provided pattern', <vscode.MessageOptions>{
                    modal: false
                });
            }
        }
    }

    private clearAllTrees() {
        this.clearDisplayedTree();
        this._filteredDependenciesTree = undefined;
        let generalInfo: GeneralInfo = new GeneralInfo('', '', [], '', '');
        this._allBuildsTree = new DependenciesTreeNode(generalInfo, vscode.TreeItemCollapsibleState.Expanded);
    }

    private clearDisplayedTree() {
        let generalInfo: GeneralInfo = new GeneralInfo('', '', [], '', '');
        this._dependenciesTree = new DependenciesTreeNode(generalInfo, vscode.TreeItemCollapsibleState.Expanded);
    }

    public get filterLicenses(): Set<ILicenseKey> {
        return this._filterLicenses;
    }

    public get filterScopes(): Set<Scope> {
        return this._filterScopes;
    }

    public get scanCacheManager(): ScanCacheManager {
        return this._scanCacheManager;
    }
}
