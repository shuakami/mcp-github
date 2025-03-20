#!/usr/bin/env node

import { Octokit } from 'octokit';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { dirname } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 配置接口
interface GitHubConfig {
  token: string;
  accept: string;
}

interface Config {
  github: GitHubConfig;
}

// 添加日志功能
class Logger {
  private logFile: string;

  constructor(logFile: string) {
    this.logFile = logFile;
    // 创建或清空日志文件
    fs.writeFileSync(this.logFile, "", { encoding: 'utf8' });
  }

  log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    // 输出到控制台
    console.error(message);

    // 写入日志文件
    try {
      fs.appendFileSync(this.logFile, logMessage, { encoding: 'utf8' });
    } catch (error) {
      console.error(`无法写入日志文件: ${error}`);
    }
  }
}

class GitHubMCP {
  private octokit: Octokit;
  private server: McpServer;
  private logger: Logger;

  constructor() {
    this.logger = new Logger(path.resolve(process.cwd(), 'github-mcp.log'));
    this.logger.log("GitHubMCP 构造函数开始初始化");

    // 直接硬编码 token 进行测试（请务必在生产使用时替换）
    const hardcodedToken = "ghp_your_test_token_here";
    this.logger.log(`使用硬编码 token: ${hardcodedToken.substring(0, 5)}...`);

    // 初始化 Octokit
    try {
      this.octokit = new Octokit({
        auth: hardcodedToken,
        timeZone: 'UTC',
        baseUrl: 'https://api.github.com',
        previews: ['machine-man-preview'],
        request: {
          timeout: 5000,
          headers: {
            'Authorization': `token ${hardcodedToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        },
      });
      this.logger.log("Octokit 实例创建成功");
    } catch (error) {
      this.logger.log(`Octokit 实例创建失败: ${error}`);
      throw error;
    }

    // 初始化 MCP Server
    try {
      this.server = new McpServer({
        name: "github-mcp",
        version: "1.0.0"
      });
      this.logger.log("McpServer 实例创建成功");
    } catch (error) {
      this.logger.log(`McpServer 实例创建失败: ${error}`);
      throw error;
    }

    // 注册所有工具
    this.registerTools();
    this.logger.log("所有工具注册完成");
  }

  // 可选：读取外部配置，但这里示例仅使用硬编码
  private loadConfig(): Config {
    try {
      const configPath = path.resolve(process.cwd(), 'config', 'config.yaml');
      this.logger.log(`尝试从 ${configPath} 读取配置`);

      if (!fs.existsSync(configPath)) {
        this.logger.log('配置文件不存在，创建默认配置');
        const defaultConfig = {
          github: {
            token: "your-github-token-here",
            accept: "application/vnd.github.v3+json"
          }
        };

        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }

        fs.writeFileSync(configPath, yaml.dump(defaultConfig), 'utf8');
        return defaultConfig;
      }

      const configFile = fs.readFileSync(configPath, 'utf8');
      this.logger.log(`成功读取配置文件内容: ${configFile.length} 字节`);
      const config = yaml.load(configFile) as Config;
      return config;
    } catch (error) {
      this.logger.log(`加载配置失败: ${error}`);
      // 返回默认配置
      return {
        github: {
          token: "your-github-token-here",
          accept: "application/vnd.github.v3+json"
        }
      };
    }
  }

  private registerTools(): void {
    this.logger.log("开始注册工具");

    // 基础：仓库操作
    this.registerRepositoryTools();
    // 分支操作
    this.registerBranchTools();
    // PR 操作
    this.registerPullRequestTools();
    // Issue 操作
    this.registerIssueTools();
    // 用户/社交操作
    this.registerUserTools();
    // 代码管理（文件/提交）
    this.registerCodeManagementTools();
    // Actions/Workflow
    this.registerWorkflowTools();
    // 团队/组织协作
    this.registerTeamCollaborationTools();
    // 安全功能
    this.registerSecurityTools();
    // 项目管理（Projects / Milestones）
    this.registerProjectManagementTools();
    // 标签 & 发布
    this.registerTagAndReleaseTools();
    // 统计 & 分析
    this.registerStatsAndAnalyticsTools();

    this.logger.log("工具注册完成");
  }

  /**
   * =================
   *  1. 仓库相关工具
   * =================
   */
  private registerRepositoryTools(): void {
    this.logger.log("注册仓库相关工具");

    // List repositories
    this.server.tool(
      "listRepositories",
      {
        type: z.enum(['all', 'owner', 'public', 'private', 'member']).optional(),
        sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
        direction: z.enum(['asc', 'desc']).optional(),
        perPage: z.number().optional(),
        format: z.enum(['json', 'human']).optional()
      },
      async ({ type = 'all', sort = 'updated', direction, perPage = 100, format = 'human' }) => {
        this.logger.log(`执行 listRepositories: type=${type}, sort=${sort}, perPage=${perPage}, format=${format}`);
        try {
          const params = {
            type,
            sort,
            direction,
            per_page: perPage
          };

          const result = await this.octokit.rest.repos.listForAuthenticatedUser(params);
          // 清洗
          const cleanedData = this.cleanGitHubResponse(result.data, 'repository');
          // 格式化
          if (format === 'human') {
            const text = this.formatForHumans(cleanedData, 'repository');
            return { content: [{ type: "text", text }] };
          } else {
            const text = this.formatJsonOutput(cleanedData);
            return { content: [{ type: "text", text }] };
          }
        } catch (error: any) {
          this.logger.log(`列出仓库错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Create repository
    this.server.tool(
      "createRepository",
      {
        name: z.string(),
        description: z.string().optional(),
        isPrivate: z.boolean().optional(),
        hasIssues: z.boolean().optional(),
        hasProjects: z.boolean().optional(),
        hasWiki: z.boolean().optional(),
        autoInit: z.boolean().optional(),
        gitignoreTemplate: z.string().optional(),
        licenseTemplate: z.string().optional()
      },
      async ({ name, description, isPrivate, hasIssues, hasProjects, hasWiki, autoInit, gitignoreTemplate, licenseTemplate }) => {
        this.logger.log(`执行 createRepository: name=${name}`);
        try {
          const result = await this.octokit.rest.repos.createForAuthenticatedUser({
            name,
            description,
            private: isPrivate,
            has_issues: hasIssues,
            has_projects: hasProjects,
            has_wiki: hasWiki,
            auto_init: autoInit,
            gitignore_template: gitignoreTemplate,
            license_template: licenseTemplate
          });
          // 清洗 & 格式化
          const cleanedData = this.cleanGitHubResponse(result.data, 'repository');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`创建仓库错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Get repository
    this.server.tool(
      "getRepository",
      {
        owner: z.string(),
        repo: z.string()
      },
      async ({ owner, repo }) => {
        this.logger.log(`执行 getRepository: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.get({
            owner,
            repo,
          });
          // 清洗 & 格式化
          const cleanedData = this.cleanGitHubResponse(result.data, 'repository');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`获取仓库错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Update repository
    this.server.tool(
      "updateRepository",
      {
        owner: z.string(),
        repo: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        homepage: z.string().optional(),
        private: z.boolean().optional(),
        hasIssues: z.boolean().optional(),
        hasProjects: z.boolean().optional(),
        hasWiki: z.boolean().optional(),
        defaultBranch: z.string().optional(),
        allowSquashMerge: z.boolean().optional(),
        allowMergeCommit: z.boolean().optional(),
        allowRebaseMerge: z.boolean().optional(),
        archived: z.boolean().optional()
      },
      async ({ owner, repo, ...data }) => {
        this.logger.log(`执行 updateRepository: owner=${owner}, repo=${repo}`);
        try {
          // 转换驼峰为 GitHub 接口要求的下划线形式
          const params: any = { owner, repo };
          if (data.hasIssues !== undefined) params.has_issues = data.hasIssues;
          if (data.hasProjects !== undefined) params.has_projects = data.hasProjects;
          if (data.hasWiki !== undefined) params.has_wiki = data.hasWiki;
          if (data.defaultBranch !== undefined) params.default_branch = data.defaultBranch;
          if (data.allowSquashMerge !== undefined) params.allow_squash_merge = data.allowSquashMerge;
          if (data.allowMergeCommit !== undefined) params.allow_merge_commit = data.allowMergeCommit;
          if (data.allowRebaseMerge !== undefined) params.allow_rebase_merge = data.allowRebaseMerge;

          ['name', 'description', 'homepage', 'private', 'archived'].forEach(key => {
            if (data[key as keyof typeof data] !== undefined) {
              params[key] = data[key as keyof typeof data];
            }
          });

          const result = await this.octokit.rest.repos.update(params);
          // 清洗 & 格式化
          const cleanedData = this.cleanGitHubResponse(result.data, 'repository');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`更新仓库错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Delete repository
    this.server.tool(
      "deleteRepository",
      {
        owner: z.string(),
        repo: z.string()
      },
      async ({ owner, repo }) => {
        this.logger.log(`执行 deleteRepository: owner=${owner}, repo=${repo}`);
        try {
          await this.octokit.rest.repos.delete({
            owner,
            repo
          });
          return { content: [{ type: "text", text: `Repository ${owner}/${repo} has been deleted.` }] };
        } catch (error: any) {
          this.logger.log(`删除仓库错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // List contributors
    this.server.tool(
      "listContributors",
      {
        owner: z.string(),
        repo: z.string(),
        anon: z.boolean().optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, anon, perPage = 100 }) => {
        this.logger.log(`执行 listContributors: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.listContributors({
            owner,
            repo,
            anon: anon ? "1" : undefined,
            per_page: perPage
          });
          // 清洗 & 格式化（通用类型，就用默认清洗）
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`获取贡献者错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * =================
   *  2. 分支相关工具
   * =================
   */
  private registerBranchTools(): void {
    this.logger.log("注册分支相关工具");

    // Create branch
    this.server.tool(
      "createBranch",
      {
        owner: z.string(),
        repo: z.string(),
        branch: z.string(),
        sha: z.string()
      },
      async ({ owner, repo, branch, sha }) => {
        this.logger.log(`执行 createBranch: owner=${owner}, repo=${repo}, branch=${branch}, sha=${sha}`);
        try {
          const result = await this.octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha,
          });
          // 清洗 & 格式化（通用类型）
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`创建分支错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Get branch
    this.server.tool(
      "getBranch",
      {
        owner: z.string(),
        repo: z.string(),
        branch: z.string()
      },
      async ({ owner, repo, branch }) => {
        this.logger.log(`执行 getBranch: owner=${owner}, repo=${repo}, branch=${branch}`);
        try {
          const result = await this.octokit.rest.repos.getBranch({
            owner,
            repo,
            branch
          });
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`获取分支错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // List branches
    this.server.tool(
      "listBranches",
      {
        owner: z.string(),
        repo: z.string(),
        protected: z.boolean().optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, protected: isProtected, perPage = 100 }) => {
        this.logger.log(`执行 listBranches: owner=${owner}, repo=${repo}, protected=${isProtected}`);
        try {
          const result = await this.octokit.rest.repos.listBranches({
            owner,
            repo,
            protected: isProtected,
            per_page: perPage
          });
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`列出分支错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Delete branch
    this.server.tool(
      "deleteBranch",
      {
        owner: z.string(),
        repo: z.string(),
        branch: z.string()
      },
      async ({ owner, repo, branch }) => {
        this.logger.log(`执行 deleteBranch: owner=${owner}, repo=${repo}, branch=${branch}`);
        try {
          await this.octokit.rest.git.deleteRef({
            owner,
            repo,
            ref: `heads/${branch}`
          });
          return { content: [{ type: "text", text: `Branch ${branch} has been deleted from ${owner}/${repo}.` }] };
        } catch (error: any) {
          this.logger.log(`删除分支错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * =================
   *  3. PR 相关工具
   * =================
   */
  private registerPullRequestTools(): void {
    this.logger.log("注册 PR 相关工具");

    // Create pull request
    this.server.tool(
      "createPullRequest",
      {
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        head: z.string(),
        base: z.string(),
        body: z.string().optional(),
        maintainerCanModify: z.boolean().optional(),
        draft: z.boolean().optional()
      },
      async ({ owner, repo, title, head, base, body, maintainerCanModify, draft }) => {
        this.logger.log(`执行 createPullRequest: owner=${owner}, repo=${repo}, title=${title}`);
        try {
          const result = await this.octokit.rest.pulls.create({
            owner,
            repo,
            title,
            head,
            base,
            body,
            maintainer_can_modify: maintainerCanModify,
            draft
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'pull_request');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`创建 PR 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Get pull request
    this.server.tool(
      "getPullRequest",
      {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number()
      },
      async ({ owner, repo, pullNumber }) => {
        this.logger.log(`执行 getPullRequest: owner=${owner}, repo=${repo}, pullNumber=${pullNumber}`);
        try {
          const result = await this.octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'pull_request');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`获取 PR 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // List pull requests
    this.server.tool(
      "listPullRequests",
      {
        owner: z.string(),
        repo: z.string(),
        state: z.enum(['open', 'closed', 'all']).optional(),
        head: z.string().optional(),
        base: z.string().optional(),
        sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional(),
        direction: z.enum(['asc', 'desc']).optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, state = 'open', head, base, sort, direction, perPage = 100 }) => {
        this.logger.log(`执行 listPullRequests: owner=${owner}, repo=${repo}, state=${state}`);
        try {
          const result = await this.octokit.rest.pulls.list({
            owner,
            repo,
            state,
            head,
            base,
            sort,
            direction,
            per_page: perPage
          });
          // 这里返回的是PR数组
          const cleanedData = this.cleanGitHubResponse(result.data, 'pull_request');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`列出 PR 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Update pull request
    this.server.tool(
      "updatePullRequest",
      {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(['open', 'closed']).optional(),
        base: z.string().optional(),
        maintainerCanModify: z.boolean().optional()
      },
      async ({ owner, repo, pullNumber, title, body, state, base, maintainerCanModify }) => {
        this.logger.log(`执行 updatePullRequest: owner=${owner}, repo=${repo}, pullNumber=${pullNumber}`);
        try {
          const result = await this.octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: pullNumber,
            title,
            body,
            state,
            base,
            maintainer_can_modify: maintainerCanModify
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'pull_request');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`更新 PR 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Merge pull request
    this.server.tool(
      "mergePullRequest",
      {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
        commitTitle: z.string().optional(),
        commitMessage: z.string().optional(),
        mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional(),
        sha: z.string().optional()
      },
      async ({ owner, repo, pullNumber, commitTitle, commitMessage, mergeMethod = 'merge', sha }) => {
        this.logger.log(`执行 mergePullRequest: owner=${owner}, repo=${repo}, pullNumber=${pullNumber}`);
        try {
          const result = await this.octokit.rest.pulls.merge({
            owner,
            repo,
            pull_number: pullNumber,
            commit_title: commitTitle,
            commit_message: commitMessage,
            merge_method: mergeMethod,
            sha
          });
          // merge后返回的数据格式比较特殊
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`合并 PR 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * =================
   *  4. Issue 相关
   * =================
   */
  private registerIssueTools(): void {
    this.logger.log("注册 Issue 相关工具");

    // Create issue
    this.server.tool(
      "createIssue",
      {
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        body: z.string().optional(),
        assignees: z.array(z.string()).optional(),
        milestone: z.number().optional(),
        labels: z.array(z.string()).optional()
      },
      async ({ owner, repo, title, body, assignees, milestone, labels }) => {
        this.logger.log(`执行 createIssue: owner=${owner}, repo=${repo}, title=${title}`);
        try {
          const result = await this.octokit.rest.issues.create({
            owner,
            repo,
            title,
            body,
            assignees,
            milestone,
            labels
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`创建 Issue 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Get issue
    this.server.tool(
      "getIssue",
      {
        owner: z.string(),
        repo: z.string(),
        issueNumber: z.number()
      },
      async ({ owner, repo, issueNumber }) => {
        this.logger.log(`执行 getIssue: owner=${owner}, repo=${repo}, issueNumber=${issueNumber}`);
        try {
          const result = await this.octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`获取 Issue 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // List issues
    this.server.tool(
      "listIssues",
      {
        owner: z.string(),
        repo: z.string(),
        state: z.enum(['open', 'closed', 'all']).optional(),
        assignee: z.string().optional(),
        creator: z.string().optional(),
        mentioned: z.string().optional(),
        labels: z.string().optional(),
        sort: z.enum(['created', 'updated', 'comments']).optional(),
        direction: z.enum(['asc', 'desc']).optional(),
        since: z.string().optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, state = 'open', assignee, creator, mentioned, labels, sort, direction, since, perPage = 100 }) => {
        this.logger.log(`执行 listIssues: owner=${owner}, repo=${repo}, state=${state}`);
        try {
          const result = await this.octokit.rest.issues.listForRepo({
            owner,
            repo,
            state,
            assignee,
            creator,
            mentioned,
            labels,
            sort,
            direction,
            since,
            per_page: perPage
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`列出 Issue 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Update issue
    this.server.tool(
      "updateIssue",
      {
        owner: z.string(),
        repo: z.string(),
        issueNumber: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(['open', 'closed']).optional(),
        assignees: z.array(z.string()).optional(),
        milestone: z.number().optional(),
        labels: z.array(z.string()).optional()
      },
      async ({ owner, repo, issueNumber, title, body, state, assignees, milestone, labels }) => {
        this.logger.log(`执行 updateIssue: owner=${owner}, repo=${repo}, issueNumber=${issueNumber}`);
        try {
          const result = await this.octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            title,
            body,
            state,
            assignees,
            milestone,
            labels
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`更新 Issue 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Close issue
    this.server.tool(
      "closeIssue",
      {
        owner: z.string(),
        repo: z.string(),
        issueNumber: z.number()
      },
      async ({ owner, repo, issueNumber }) => {
        this.logger.log(`执行 closeIssue: owner=${owner}, repo=${repo}, issueNumber=${issueNumber}`);
        try {
          const result = await this.octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            state: 'closed'
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`关闭 Issue 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * =======================
   *  5. 用户相关的操作示例
   * =======================
   */
  private registerUserTools(): void {
    this.logger.log("注册用户/社交操作相关工具");

    // 列出某用户关注的人
    this.server.tool(
      "listFollowing",
      {
        username: z.string(),
        perPage: z.number().optional(),
        format: z.enum(['json', 'human']).optional()
      },
      async ({ username, perPage = 100, format = 'human' }) => {
        this.logger.log(`执行 listFollowing: username=${username}, perPage=${perPage}, format=${format}`);
        try {
          // 列出用户所关注的所有人
          const followingResult = await this.octokit.rest.users.listFollowingForUser({
            username,
            per_page: perPage
          });
          const followingList = followingResult.data; // 用户对象数组

          if (!followingList || followingList.length === 0) {
            return { content: [{ type: "text", text: `用户 ${username} 没有关注任何人。` }] };
          }

          // 清洗数据
          const cleanedList = this.cleanGitHubResponse(followingList, 'user');

          // 格式化
          if (format === 'human') {
            let result = `用户 ${username} 关注了以下 ${cleanedList.length} 个用户:\n\n`;
            cleanedList.forEach((user: any, index: number) => {
              result += `${index + 1}. ${user.login || user.name}\n`;
              if (user.html_url) result += `   主页: ${user.html_url}\n`;
              if (user.description) result += `   描述: ${user.description}\n`;
              result += `\n`;
            });
            return { content: [{ type: "text", text: result }] };
          } else {
            const text = this.formatJsonOutput(cleanedList);
            return { content: [{ type: "text", text: text }] };
          }
        } catch (error: any) {
          this.logger.log(`listFollowing 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出某用户关注的人下的所有仓库
    this.server.tool(
      "listFollowingUserRepos",
      {
        username: z.string(),
        perPage: z.number().optional(),
        format: z.enum(['json', 'human']).optional()
      },
      async ({ username, perPage = 30, format = 'human' }) => {
        this.logger.log(`执行 listFollowingUserRepos: username=${username}, perPage=${perPage}, format=${format}`);
        try {
          // 先列出用户所关注的所有人
          const followingResult = await this.octokit.rest.users.listFollowingForUser({
            username,
            per_page: perPage
          });
          const followingList = followingResult.data; // 用户对象数组

          if (!followingList || followingList.length === 0) {
            return { content: [{ type: "text", text: `用户 ${username} 没有关注任何人，或者信息为空。` }] };
          }

          let allRepos: any[] = [];
          for (const followUser of followingList) {
            // 获取对方的仓库
            const reposResult = await this.octokit.rest.repos.listForUser({
              username: followUser.login,
              per_page: perPage
            });
            // 清洗
            const cleanedRepos = this.cleanGitHubResponse(reposResult.data, 'repository');
            // 附加标记
            const reposWithOwnerMarker = Array.isArray(cleanedRepos)
              ? cleanedRepos.map(r => ({
                  ...r,
                  followedByUser: username,
                  belongsTo: followUser.login
                }))
              : [];
            allRepos = [...allRepos, ...reposWithOwnerMarker];
          }

          if (allRepos.length === 0) {
            return { content: [{ type: "text", text: `未能查询到任何仓库。` }] };
          }

          if (format === 'human') {
            const text = this.formatForHumans(allRepos, 'repository');
            return { content: [{ type: "text", text: text }] };
          } else {
            const text = this.formatJsonOutput(allRepos);
            return { content: [{ type: "text", text: text }] };
          }
        } catch (error: any) {
          this.logger.log(`listFollowingUserRepos 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出和指定用户交流最频繁的其它用户 (基于Issue/PR评论等简单统计)
    this.server.tool(
      "listFrequentCommunicators",
      {
        username: z.string(),
        repoPerPage: z.number().optional(),
        issuePerPage: z.number().optional(),
        commentPerPage: z.number().optional(),
        format: z.enum(['json', 'human']).optional()
      },
      async ({ username, repoPerPage = 5, issuePerPage = 5, commentPerPage = 5, format = 'human' }) => {
        this.logger.log(`执行 listFrequentCommunicators: username=${username}`);
        try {
          // 获取该用户的仓库
          const { data: userRepos } = await this.octokit.rest.repos.listForUser({
            username,
            per_page: repoPerPage
          });

          if (!userRepos || userRepos.length === 0) {
            return { content: [{ type: "text", text: `用户 ${username} 没有任何公开仓库。` }] };
          }

          const freqMap: Record<string, number> = {};

          // 遍历仓库
          for (const repo of userRepos) {
            // 列出 issues
            const { data: issues } = await this.octokit.rest.issues.listForRepo({
              owner: repo.owner?.login || username,
              repo: repo.name,
              per_page: issuePerPage,
              state: 'all'
            });
            for (const issue of issues) {
              // issue 作者
              if (issue.user && issue.user.login && issue.user.login !== username) {
                freqMap[issue.user.login] = (freqMap[issue.user.login] || 0) + 1;
              }
              // issue 评论者
              const { data: comments } = await this.octokit.rest.issues.listComments({
                owner: repo.owner?.login || username,
                repo: repo.name,
                issue_number: issue.number,
                per_page: commentPerPage
              });
              for (const cm of comments) {
                if (cm.user && cm.user.login && cm.user.login !== username) {
                  freqMap[cm.user.login] = (freqMap[cm.user.login] || 0) + 1;
                }
              }
            }

            // 再列出所有 PR
            try {
              const { data: pullRequests } = await this.octokit.rest.pulls.list({
                owner: repo.owner?.login || username,
                repo: repo.name,
                state: 'all',
                per_page: issuePerPage
              });
              for (const pr of pullRequests) {
                // PR 作者
                if (pr.user && pr.user.login && pr.user.login !== username) {
                  // PR作者权重略高
                  freqMap[pr.user.login] = (freqMap[pr.user.login] || 0) + 2;
                }
                // PR 评论
                try {
                  const { data: prComments } = await this.octokit.rest.pulls.listReviewComments({
                    owner: repo.owner?.login || username,
                    repo: repo.name,
                    pull_number: pr.number,
                    per_page: commentPerPage
                  });
                  for (const prComment of prComments) {
                    if (prComment.user && prComment.user.login && prComment.user.login !== username) {
                      freqMap[prComment.user.login] = (freqMap[prComment.user.login] || 0) + 1;
                    }
                  }
                } catch (prCommentError) {
                  this.logger.log(`获取PR评论错误: ${prCommentError}`);
                }
              }
            } catch (prError) {
              this.logger.log(`获取仓库PR错误: ${prError}`);
            }
          }

          // 简单示例：再去对方的仓库看这个 username 是否有提交或PR
          // (此步骤仅做示例，可根据需求自定义)
          try {
            const topUsers = Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, 5);
            for (const otherUser of topUsers) {
              // 获取对方仓库
              const { data: otherUserRepos } = await this.octokit.rest.repos.listForUser({
                username: otherUser,
                per_page: 3
              });
              for (const otherRepo of otherUserRepos) {
                // 查找 currentUser 在对方仓库的PR
                const { data: userPRs } = await this.octokit.rest.pulls.list({
                  owner: otherUser,
                  repo: otherRepo.name,
                  state: 'all',
                  per_page: 5
                });
                for (const pr of userPRs) {
                  if (pr.user && pr.user.login === username) {
                    freqMap[otherUser] = (freqMap[otherUser] || 0) + 3;
                  }
                }
              }
            }
          } catch (otherRepoError) {
            this.logger.log(`检查用户互动PR错误: ${otherRepoError}`);
          }

          const sorted = Object.entries(freqMap).sort((a, b) => b[1] - a[1]).map(([user, count]) => ({ user, count }));

          if (sorted.length === 0) {
            return { content: [{ type: "text", text: `没有发现任何与用户 ${username} 交流过的其他用户。` }] };
          }

          // 过滤掉常见机器人用户名
          const botPatterns = [
            /\[bot\]$/,
            /^dependabot/,
            /^github-actions/,
            /^codecov/,
            /^renovate/,
            /^imgbot/,
            /^vercel/,
            /^snyk-bot/,
            /^stale/,
            /^app\//
          ];
          const filteredSorted = sorted.filter(item => !botPatterns.some(pattern => pattern.test(item.user)));
          if (filteredSorted.length === 0) {
            return { content: [{ type: "text", text: `没有发现任何与用户 ${username} 交流过的其他人类用户。` }] };
          }

          if (format === 'human') {
            let result = `用户 ${username} 的仓库中最常与之互动的其他用户（已过滤机器人）：\n\n`;
            filteredSorted.forEach((item, index) => {
              result += `${index + 1}. 用户: ${item.user}, 互动次数: ${item.count}\n`;
            });
            return { content: [{ type: "text", text: result }] };
          } else {
            return { content: [{ type: "text", text: this.formatJsonOutput(filteredSorted) }] };
          }
        } catch (error: any) {
          this.logger.log(`listFrequentCommunicators 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * ===================================
   *  6. 代码管理（文件内容 & 提交管理）
   * ===================================
   */
  private registerCodeManagementTools(): void {
    this.logger.log("注册代码管理相关工具");

    // 获取文件内容
    this.server.tool(
      "getFileContent",
      {
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        ref: z.string().optional()  // 分支或提交 SHA，可选
      },
      async ({ owner, repo, path, ref }) => {
        this.logger.log(`执行 getFileContent: owner=${owner}, repo=${repo}, path=${path}, ref=${ref}`);
        try {
          const result = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref
          });

          if (Array.isArray(result.data)) {
            // 如果是目录，会返回一个数组
            return {
              content: [{
                type: "text",
                text: `目标路径是一个目录，包含以下内容:\n\n${this.formatJsonOutput(result.data)}`
              }]
            };
          }

          // 是单文件
          const fileData = result.data;
          if (!("content" in fileData)) {
            return { content: [{ type: "text", text: `无法读取文件内容，可能不是一个普通文件。` }] };
          }

          const encodedContent = fileData.content;
          const decodedContent = Buffer.from(encodedContent, 'base64').toString('utf-8');

          // 简单截断过长内容
          const truncated = decodedContent.length > 2000 
            ? decodedContent.substring(0, 2000) + "\n...（内容过长，已截断）" 
            : decodedContent;

          return { 
            content: [{
              type: "text",
              text: `文件内容 (base64解码后, 可能截断):\n\n${truncated}`
            }]
          };
        } catch (error: any) {
          this.logger.log(`获取文件内容错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 创建/更新文件内容（会自动创建一个提交）
    this.server.tool(
      "updateFileContent",
      {
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        message: z.string(),
        content: z.string(),  // 要写入的纯文本，会自动 base64
        branch: z.string().optional(),
        sha: z.string().optional() // 如果更新已有文件需要提供
      },
      async ({ owner, repo, path, message, content, branch, sha }) => {
        this.logger.log(`执行 updateFileContent: owner=${owner}, repo=${repo}, path=${path}`);
        try {
          const result = await this.octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            message,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch,
            sha
          });

          // 返回提交信息
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`更新文件内容错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出提交
    this.server.tool(
      "listCommits",
      {
        owner: z.string(),
        repo: z.string(),
        sha: z.string().optional(),
        path: z.string().optional(),
        author: z.string().optional(),
        since: z.string().optional(),  // ISO 时间，如 '2021-01-01T00:00:00Z'
        until: z.string().optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, sha, path, author, since, until, perPage = 30 }) => {
        this.logger.log(`执行 listCommits: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.listCommits({
            owner,
            repo,
            sha,
            path,
            author,
            since,
            until,
            per_page: perPage
          });

          // 提交数组
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`列出提交错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取指定提交
    this.server.tool(
      "getCommit",
      {
        owner: z.string(),
        repo: z.string(),
        ref: z.string() // 提交 SHA 或分支名或 tag
      },
      async ({ owner, repo, ref }) => {
        this.logger.log(`执行 getCommit: owner=${owner}, repo=${repo}, ref=${ref}`);
        try {
          const result = await this.octokit.rest.repos.getCommit({
            owner,
            repo,
            ref
          });
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`获取提交错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 创建一个 commit（高级用法：使用 Git Data API 直接创建）
    this.server.tool(
      "createCommit",
      {
        owner: z.string(),
        repo: z.string(),
        message: z.string(),
        tree: z.string(),
        parents: z.array(z.string()),
        authorName: z.string().optional(),
        authorEmail: z.string().optional()
      },
      async ({ owner, repo, message, tree, parents, authorName, authorEmail }) => {
        this.logger.log(`执行 createCommit: owner=${owner}, repo=${repo}, message=${message}`);
        try {
          const result = await this.octokit.rest.git.createCommit({
            owner,
            repo,
            message,
            tree,
            parents,
            author: authorName && authorEmail ? {
              name: authorName,
              email: authorEmail,
              date: new Date().toISOString()
            } : undefined
          });
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatJsonOutput(cleanedData);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`创建提交错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * =====================================
   *  7. Workflow/Actions 管理相关工具
   * =====================================
   */
  private registerWorkflowTools(): void {
    this.logger.log("注册 Actions / Workflow 管理相关工具");

    // 列出仓库的所有工作流
    this.server.tool(
      "listWorkflows",
      {
        owner: z.string(),
        repo: z.string()
      },
      async ({ owner, repo }) => {
        this.logger.log(`执行 listWorkflows: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.actions.listRepoWorkflows({
            owner,
            repo
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`listWorkflows 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取单个 workflow
    this.server.tool(
      "getWorkflow",
      {
        owner: z.string(),
        repo: z.string(),
        workflowId: z.union([z.string(), z.number()])
      },
      async ({ owner, repo, workflowId }) => {
        this.logger.log(`执行 getWorkflow: owner=${owner}, repo=${repo}, workflowId=${workflowId}`);
        try {
          const result = await this.octokit.rest.actions.getWorkflow({
            owner,
            repo,
            workflow_id: workflowId
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getWorkflow 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 触发 workflow dispatch
    this.server.tool(
      "dispatchWorkflow",
      {
        owner: z.string(),
        repo: z.string(),
        workflowId: z.union([z.string(), z.number()]),
        ref: z.string(),
        inputs: z.record(z.string()).optional() // workflow dispatch inputs
      },
      async ({ owner, repo, workflowId, ref, inputs }) => {
        this.logger.log(`执行 dispatchWorkflow: owner=${owner}, repo=${repo}, workflowId=${workflowId}, ref=${ref}`);
        try {
          await this.octokit.rest.actions.createWorkflowDispatch({
            owner,
            repo,
            workflow_id: workflowId,
            ref,
            inputs
          });
          return { content: [{ type: "text", text: `已成功触发 Workflow Dispatch。` }] };
        } catch (error: any) {
          this.logger.log(`dispatchWorkflow 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出指定 workflow 的运行
    this.server.tool(
      "listWorkflowRuns",
      {
        owner: z.string(),
        repo: z.string(),
        workflowId: z.union([z.string(), z.number()]).optional(),
        actor: z.string().optional(),
        branch: z.string().optional(),
        event: z.string().optional(),
        status: z.string().optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, workflowId, actor, branch, event, status, perPage = 30 }) => {
        this.logger.log(`执行 listWorkflowRuns: owner=${owner}, repo=${repo}, workflowId=${workflowId}`);
        try {
          const params: any = { owner, repo, per_page: perPage };
          if (workflowId) params.workflow_id = workflowId;
          if (actor) params.actor = actor;
          if (branch) params.branch = branch;
          if (event) params.event = event;
          if (status) params.status = status;

          const result = workflowId
            ? await this.octokit.rest.actions.listWorkflowRuns(params)
            : await this.octokit.rest.actions.listWorkflowRunsForRepo(params);

          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`listWorkflowRuns 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取单个 workflow run
    this.server.tool(
      "getWorkflowRun",
      {
        owner: z.string(),
        repo: z.string(),
        runId: z.number()
      },
      async ({ owner, repo, runId }) => {
        this.logger.log(`执行 getWorkflowRun: owner=${owner}, repo=${repo}, runId=${runId}`);
        try {
          const result = await this.octokit.rest.actions.getWorkflowRun({
            owner,
            repo,
            run_id: runId
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getWorkflowRun 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 重新运行 workflow
    this.server.tool(
      "rerunWorkflow",
      {
        owner: z.string(),
        repo: z.string(),
        runId: z.number()
      },
      async ({ owner, repo, runId }) => {
        this.logger.log(`执行 rerunWorkflow: owner=${owner}, repo=${repo}, runId=${runId}`);
        try {
          await this.octokit.rest.actions.reRunWorkflow({
            owner,
            repo,
            run_id: runId
          });
          return { content: [{ type: "text", text: `已成功请求重新运行 Workflow。` }] };
        } catch (error:any) {
          this.logger.log(`rerunWorkflow 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * ===========================
   *  8. 团队协作/组织相关工具
   * ===========================
   */
  private registerTeamCollaborationTools(): void {
    this.logger.log("注册组织/团队/协作者管理相关工具");

    // 列出当前账号所在组织
    this.server.tool(
      "listMyOrgs",
      {},
      async () => {
        this.logger.log(`执行 listMyOrgs`);
        try {
          const result = await this.octokit.rest.orgs.listForAuthenticatedUser();
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`listMyOrgs 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出指定用户所在组织
    this.server.tool(
      "listUserOrgs",
      {
        username: z.string()
      },
      async ({ username }) => {
        this.logger.log(`执行 listUserOrgs: username=${username}`);
        try {
          const result = await this.octokit.rest.orgs.listForUser({ username });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`listUserOrgs 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取单个组织
    this.server.tool(
      "getOrg",
      {
        org: z.string()
      },
      async ({ org }) => {
        this.logger.log(`执行 getOrg: org=${org}`);
        try {
          const result = await this.octokit.rest.orgs.get({ org });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getOrg 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出组织下的团队
    this.server.tool(
      "listOrgTeams",
      {
        org: z.string()
      },
      async ({ org }) => {
        this.logger.log(`执行 listOrgTeams: org=${org}`);
        try {
          const result = await this.octokit.rest.teams.list({ org });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`listOrgTeams 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 创建团队
    this.server.tool(
      "createTeam",
      {
        org: z.string(),
        name: z.string(),
        description: z.string().optional(),
        privacy: z.enum(["secret", "closed"]).optional()
      },
      async ({ org, name, description, privacy }) => {
        this.logger.log(`执行 createTeam: org=${org}, name=${name}`);
        try {
          const result = await this.octokit.rest.teams.create({
            org,
            name,
            description,
            privacy
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`createTeam 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 添加或更新团队对某用户的Membership
    this.server.tool(
      "addOrUpdateTeamMembership",
      {
        org: z.string(),
        teamSlug: z.string(),
        username: z.string(),
        role: z.enum(["member", "maintainer"]).optional()
      },
      async ({ org, teamSlug, username, role }) => {
        this.logger.log(`执行 addOrUpdateTeamMembership: org=${org}, teamSlug=${teamSlug}, user=${username}`);
        try {
          const result = await this.octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
            org,
            team_slug: teamSlug,
            username,
            role
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`addOrUpdateTeamMembership 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 移除团队成员
    this.server.tool(
      "removeTeamMembership",
      {
        org: z.string(),
        teamSlug: z.string(),
        username: z.string()
      },
      async ({ org, teamSlug, username }) => {
        this.logger.log(`执行 removeTeamMembership: org=${org}, teamSlug=${teamSlug}, user=${username}`);
        try {
          await this.octokit.rest.teams.removeMembershipForUserInOrg({
            org,
            team_slug: teamSlug,
            username
          });
          return { content: [{ type: "text", text: `成功移除团队成员 ${username}.` }] };
        } catch (error:any) {
          this.logger.log(`removeTeamMembership 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 仓库添加协作者
    this.server.tool(
      "addCollaborator",
      {
        owner: z.string(),
        repo: z.string(),
        username: z.string(),
        permission: z.enum(["pull", "push", "admin", "maintain", "triage"]).optional()
      },
      async ({ owner, repo, username, permission }) => {
        this.logger.log(`执行 addCollaborator: owner=${owner}, repo=${repo}, user=${username}`);
        try {
          const result = await this.octokit.rest.repos.addCollaborator({
            owner,
            repo,
            username,
            permission
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`addCollaborator 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 移除仓库协作者
    this.server.tool(
      "removeCollaborator",
      {
        owner: z.string(),
        repo: z.string(),
        username: z.string()
      },
      async ({ owner, repo, username }) => {
        this.logger.log(`执行 removeCollaborator: owner=${owner}, repo=${repo}, user=${username}`);
        try {
          await this.octokit.rest.repos.removeCollaborator({
            owner,
            repo,
            username
          });
          return { content: [{ type: "text", text: `成功移除仓库协作者 ${username}.` }] };
        } catch (error:any) {
          this.logger.log(`removeCollaborator 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * =====================
   *  9. 安全功能相关工具
   * =====================
   *
   * 这里只示例了「代码扫描」Alerts 管理接口，
   * 其它如 Dependabot Alerts、Security Advisory 等也可参考类似模式使用。
   */
  private registerSecurityTools(): void {
    this.logger.log("注册安全功能相关工具");

    // 列出代码扫描警告
    this.server.tool(
      "listCodeScanningAlerts",
      {
        owner: z.string(),
        repo: z.string(),
        state: z.enum(["open", "closed", "dismissed"]).optional(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, state, perPage = 30 }) => {
        this.logger.log(`执行 listCodeScanningAlerts: owner=${owner}, repo=${repo}, state=${state}`);
        try {
          // 类型转换，将'closed'转换为'fixed'
          const apiState = state === 'closed' ? 'fixed' : state;
          
          const result = await this.octokit.rest.codeScanning.listAlertsForRepo({
            owner,
            repo,
            state: apiState as "open" | "fixed" | "dismissed" | null | undefined,
            per_page: perPage
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`listCodeScanningAlerts 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取单个代码扫描警告
    this.server.tool(
      "getCodeScanningAlert",
      {
        owner: z.string(),
        repo: z.string(),
        alertNumber: z.number()
      },
      async ({ owner, repo, alertNumber }) => {
        this.logger.log(`执行 getCodeScanningAlert: owner=${owner}, repo=${repo}, alert=${alertNumber}`);
        try {
          const result = await this.octokit.rest.codeScanning.getAlert({
            owner,
            repo,
            alert_number: alertNumber
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getCodeScanningAlert 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 更新代码扫描警告（可以将其关闭/驳回等）
    this.server.tool(
      "updateCodeScanningAlert",
      {
        owner: z.string(),
        repo: z.string(),
        alertNumber: z.number(),
        state: z.enum(["open", "dismissed", "fixed"]).optional(),
        dismissedReason: z.string().optional()
      },
      async ({ owner, repo, alertNumber, state, dismissedReason }) => {
        this.logger.log(`执行 updateCodeScanningAlert: owner=${owner}, repo=${repo}, alertNumber=${alertNumber}`);
        try {
          // 检查并转换为API接受的值
          const validDismissedReason = dismissedReason 
            ? (dismissedReason === "false positive" || dismissedReason === "won't fix" || dismissedReason === "used in tests" 
              ? dismissedReason 
              : null) 
            : undefined;

          const result = await this.octokit.rest.codeScanning.updateAlert({
            owner,
            repo,
            alert_number: alertNumber,
            state: state as "open" | "dismissed",
            dismissed_reason: validDismissedReason
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`updateCodeScanningAlert 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * ===============================
   *  10. 项目管理（Projects等）
   * ===============================
   */
  private registerProjectManagementTools(): void {
    this.logger.log("注册项目管理相关工具");

    // 列出仓库 Projects
    this.server.tool(
      "listProjects",
      {
        owner: z.string(),
        repo: z.string(),
        state: z.enum(["open", "closed", "all"]).optional()
      },
      async ({ owner, repo, state = "open" }) => {
        this.logger.log(`执行 listProjects: owner=${owner}, repo=${repo}, state=${state}`);
        try {
          const result = await this.octokit.rest.projects.listForRepo({
            owner,
            repo,
            state
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`listProjects 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 创建项目
    this.server.tool(
      "createProject",
      {
        owner: z.string(),
        repo: z.string(),
        name: z.string(),
        body: z.string().optional()
      },
      async ({ owner, repo, name, body }) => {
        this.logger.log(`执行 createProject: owner=${owner}, repo=${repo}, name=${name}`);
        try {
          const result = await this.octokit.rest.projects.createForRepo({
            owner,
            repo,
            name,
            body
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`createProject 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取项目
    this.server.tool(
      "getProject",
      {
        projectId: z.number()
      },
      async ({ projectId }) => {
        this.logger.log(`执行 getProject: projectId=${projectId}`);
        try {
          const result = await this.octokit.rest.projects.get({
            project_id: projectId
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getProject 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 更新项目
    this.server.tool(
      "updateProject",
      {
        projectId: z.number(),
        name: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional()
      },
      async ({ projectId, name, body, state }) => {
        this.logger.log(`执行 updateProject: projectId=${projectId}`);
        try {
          const result = await this.octokit.rest.projects.update({
            project_id: projectId,
            name,
            body,
            state
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`updateProject 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 删除项目
    this.server.tool(
      "deleteProject",
      {
        projectId: z.number()
      },
      async ({ projectId }) => {
        this.logger.log(`执行 deleteProject: projectId=${projectId}`);
        try {
          await this.octokit.rest.projects.delete({
            project_id: projectId
          });
          return { content: [{ type: "text", text: `项目 ${projectId} 已删除。` }] };
        } catch (error:any) {
          this.logger.log(`deleteProject 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 里程碑管理
    // 列出 milestones
    this.server.tool(
      "listMilestones",
      {
        owner: z.string(),
        repo: z.string(),
        state: z.enum(["open", "closed", "all"]).optional()
      },
      async ({ owner, repo, state = "open" }) => {
        this.logger.log(`执行 listMilestones: owner=${owner}, repo=${repo}, state=${state}`);
        try {
          const result = await this.octokit.rest.issues.listMilestones({
            owner,
            repo,
            state
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`listMilestones 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 创建 milestone
    this.server.tool(
      "createMilestone",
      {
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        state: z.enum(["open", "closed"]).optional(),
        description: z.string().optional(),
        dueOn: z.string().optional()
      },
      async ({ owner, repo, title, state, description, dueOn }) => {
        this.logger.log(`执行 createMilestone: owner=${owner}, repo=${repo}, title=${title}`);
        try {
          const result = await this.octokit.rest.issues.createMilestone({
            owner,
            repo,
            title,
            state,
            description,
            due_on: dueOn
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`createMilestone 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取 milestone
    this.server.tool(
      "getMilestone",
      {
        owner: z.string(),
        repo: z.string(),
        milestoneNumber: z.number()
      },
      async ({ owner, repo, milestoneNumber }) => {
        this.logger.log(`执行 getMilestone: owner=${owner}, repo=${repo}, milestoneNumber=${milestoneNumber}`);
        try {
          const result = await this.octokit.rest.issues.getMilestone({
            owner,
            repo,
            milestone_number: milestoneNumber
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getMilestone 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 更新 milestone
    this.server.tool(
      "updateMilestone",
      {
        owner: z.string(),
        repo: z.string(),
        milestoneNumber: z.number(),
        title: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        description: z.string().optional(),
        dueOn: z.string().optional()
      },
      async ({ owner, repo, milestoneNumber, title, state, description, dueOn }) => {
        this.logger.log(`执行 updateMilestone: owner=${owner}, repo=${repo}, milestoneNumber=${milestoneNumber}`);
        try {
          const result = await this.octokit.rest.issues.updateMilestone({
            owner,
            repo,
            milestone_number: milestoneNumber,
            title,
            state,
            description,
            due_on: dueOn
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`updateMilestone 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 删除 milestone
    this.server.tool(
      "deleteMilestone",
      {
        owner: z.string(),
        repo: z.string(),
        milestoneNumber: z.number()
      },
      async ({ owner, repo, milestoneNumber }) => {
        this.logger.log(`执行 deleteMilestone: owner=${owner}, repo=${repo}, milestoneNumber=${milestoneNumber}`);
        try {
          await this.octokit.rest.issues.deleteMilestone({
            owner,
            repo,
            milestone_number: milestoneNumber
          });
          return { content: [{ type: "text", text: `Milestone #${milestoneNumber} 已删除。` }] };
        } catch (error:any) {
          this.logger.log(`deleteMilestone 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * ============================
   *  11. 标签 & 发布版本工具
   * ============================
   */
  private registerTagAndReleaseTools(): void {
    this.logger.log("注册标签 & 发布管理相关工具");

    // 列出仓库所有 Tag
    this.server.tool(
      "listTags",
      {
        owner: z.string(),
        repo: z.string(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, perPage = 30 }) => {
        this.logger.log(`执行 listTags: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.listTags({
            owner,
            repo,
            per_page: perPage
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`listTags 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 创建 release
    this.server.tool(
      "createRelease",
      {
        owner: z.string(),
        repo: z.string(),
        tagName: z.string(),
        targetCommitish: z.string().optional(),
        name: z.string().optional(),
        body: z.string().optional(),
        draft: z.boolean().optional(),
        prerelease: z.boolean().optional()
      },
      async ({ owner, repo, tagName, targetCommitish, name, body, draft, prerelease }) => {
        this.logger.log(`执行 createRelease: owner=${owner}, repo=${repo}, tag=${tagName}`);
        try {
          const result = await this.octokit.rest.repos.createRelease({
            owner,
            repo,
            tag_name: tagName,
            target_commitish: targetCommitish,
            name,
            body,
            draft,
            prerelease
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`createRelease 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出所有 release
    this.server.tool(
      "listReleases",
      {
        owner: z.string(),
        repo: z.string(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, perPage = 30 }) => {
        this.logger.log(`执行 listReleases: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.listReleases({
            owner,
            repo,
            per_page: perPage
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`listReleases 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 获取 release
    this.server.tool(
      "getRelease",
      {
        owner: z.string(),
        repo: z.string(),
        releaseId: z.number()
      },
      async ({ owner, repo, releaseId }) => {
        this.logger.log(`执行 getRelease: owner=${owner}, repo=${repo}, releaseId=${releaseId}`);
        try {
          const result = await this.octokit.rest.repos.getRelease({
            owner,
            repo,
            release_id: releaseId
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getRelease 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 更新 release
    this.server.tool(
      "updateRelease",
      {
        owner: z.string(),
        repo: z.string(),
        releaseId: z.number(),
        tagName: z.string().optional(),
        targetCommitish: z.string().optional(),
        name: z.string().optional(),
        body: z.string().optional(),
        draft: z.boolean().optional(),
        prerelease: z.boolean().optional()
      },
      async ({ owner, repo, releaseId, tagName, targetCommitish, name, body, draft, prerelease }) => {
        this.logger.log(`执行 updateRelease: owner=${owner}, repo=${repo}, releaseId=${releaseId}`);
        try {
          const result = await this.octokit.rest.repos.updateRelease({
            owner,
            repo,
            release_id: releaseId,
            tag_name: tagName,
            target_commitish: targetCommitish,
            name,
            body,
            draft,
            prerelease
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`updateRelease 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 删除 release
    this.server.tool(
      "deleteRelease",
      {
        owner: z.string(),
        repo: z.string(),
        releaseId: z.number()
      },
      async ({ owner, repo, releaseId }) => {
        this.logger.log(`执行 deleteRelease: owner=${owner}, repo=${repo}, releaseId=${releaseId}`);
        try {
          await this.octokit.rest.repos.deleteRelease({
            owner,
            repo,
            release_id: releaseId
          });
          return { content: [{ type: "text", text: `Release #${releaseId} 已删除。` }] };
        } catch (error:any) {
          this.logger.log(`deleteRelease 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * ===========================
   * 12. 统计 & 分析相关工具
   * ===========================
   */
  private registerStatsAndAnalyticsTools(): void {
    this.logger.log("注册统计和分析相关工具");

    // 仓库流量统计：克隆数
    this.server.tool(
      "getRepoTrafficClones",
      {
        owner: z.string(),
        repo: z.string(),
        per: z.enum(["day", "week"]).optional()
      },
      async ({ owner, repo, per = "day" }) => {
        this.logger.log(`执行 getRepoTrafficClones: owner=${owner}, repo=${repo}, per=${per}`);
        try {
          const result = await this.octokit.rest.repos.getClones({
            owner,
            repo,
            per
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          this.logger.log(`getRepoTrafficClones 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 仓库流量统计：访问数
    this.server.tool(
      "getRepoTrafficViews",
      {
        owner: z.string(),
        repo: z.string(),
        per: z.enum(["day", "week"]).optional()
      },
      async ({ owner, repo, per = "day" }) => {
        this.logger.log(`执行 getRepoTrafficViews: owner=${owner}, repo=${repo}, per=${per}`);
        try {
          const result = await this.octokit.rest.repos.getViews({
            owner,
            repo,
            per
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`getRepoTrafficViews 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 代码频率分析 (Code frequency) - 返回一周一组 [<week>, <additions>, <deletions>] 数据
    this.server.tool(
      "getCodeFrequencyStats",
      {
        owner: z.string(),
        repo: z.string()
      },
      async ({ owner, repo }) => {
        this.logger.log(`执行 getCodeFrequencyStats: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.getCodeFrequencyStats({
            owner,
            repo
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`getCodeFrequencyStats 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 提交活动统计 (Commit activity) - 返回一年 52 周的提交数
    this.server.tool(
      "getCommitActivityStats",
      {
        owner: z.string(),
        repo: z.string()
      },
      async ({ owner, repo }) => {
        this.logger.log(`执行 getCommitActivityStats: owner=${owner}, repo=${repo}`);
        try {
          const result = await this.octokit.rest.repos.getCommitActivityStats({
            owner,
            repo
          });
          const text = this.formatJsonOutput(result.data);
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          this.logger.log(`getCommitActivityStats 错误: ${error}`);
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  // ----------------------
  // 统一的清洗函数
  // ----------------------
  private cleanGitHubResponse(data: any, type: string): any {
    this.logger.log(`清洗 ${type} 数据开始`);

    try {
      // 通用去除多余字段
      const removeExcessiveFields = (obj: any) => {
        const result: any = {};
        // 只保留以下关键字段
        const keysToKeep = [
          'id',
          'name',
          'login',
          'full_name',
          'html_url',
          'description',
          'private',
          'created_at',
          'updated_at',
          'pushed_at',
          'language',
          'default_branch',
          'number',
          'title',
          'state',
          'body',
          'sha'
        ];

        for (const key of keysToKeep) {
          if (obj[key] !== undefined) {
            // 截断长文本
            if (
              typeof obj[key] === 'string' &&
              obj[key].length > 300 &&
              (key === 'body' || key === 'description')
            ) {
              result[key] = obj[key].substring(0, 300) + '...';
            } else {
              result[key] = obj[key];
            }
          }
        }

        // 特殊处理用户/owner字段
        if (obj.owner && typeof obj.owner === 'object' && obj.owner.login) {
          result.owner = obj.owner.login;
        }
        if (obj.user && typeof obj.user === 'object' && obj.user.login) {
          result.user = obj.user.login;
        }

        return result;
      };

      // 针对不同类型进一步做特化清洗
      switch (type) {
        case 'repository':
          if (Array.isArray(data)) {
            return data.map(repo => {
              const cleaned = removeExcessiveFields(repo);
              if (repo.topics) cleaned.topics = repo.topics;
              if (repo.open_issues_count !== undefined)
                cleaned.open_issues_count = repo.open_issues_count;
              if (repo.clone_url) cleaned.clone_url = repo.clone_url;
              if (repo.stargazers_count !== undefined) cleaned.stars = repo.stargazers_count;
              if (repo.visibility) cleaned.visibility = repo.visibility;
              return cleaned;
            });
          } else {
            const cleaned = removeExcessiveFields(data);
            if (data.topics) cleaned.topics = data.topics;
            if (data.open_issues_count !== undefined)
              cleaned.open_issues_count = data.open_issues_count;
            if (data.clone_url) cleaned.clone_url = data.clone_url;
            if (data.stargazers_count !== undefined) cleaned.stars = data.stargazers_count;
            if (data.visibility) cleaned.visibility = data.visibility;
            return cleaned;
          }

        case 'pull_request':
          if (Array.isArray(data)) {
            return data.map(pr => {
              const cleaned = removeExcessiveFields(pr);
              if (pr.merged_at) cleaned.merged_at = pr.merged_at;
              if (pr.head && pr.head.ref) cleaned.head_branch = pr.head.ref;
              if (pr.base && pr.base.ref) cleaned.base_branch = pr.base.ref;
              if (pr.merged !== undefined) cleaned.merged = pr.merged;
              return cleaned;
            });
          } else {
            const cleaned = removeExcessiveFields(data);
            if (data.merged_at) cleaned.merged_at = data.merged_at;
            if (data.head && data.head.ref) cleaned.head_branch = data.head.ref;
            if (data.base && data.base.ref) cleaned.base_branch = data.base.ref;
            if (data.merged !== undefined) cleaned.merged = data.merged;
            return cleaned;
          }

        case 'issue':
          if (Array.isArray(data)) {
            return data.map(issue => {
              const cleaned = removeExcessiveFields(issue);
              if (issue.closed_at) cleaned.closed_at = issue.closed_at;
              if (issue.labels) {
                cleaned.labels = Array.isArray(issue.labels)
                  ? issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name))
                  : issue.labels;
              }
              if (issue.assignees) {
                cleaned.assignees = Array.isArray(issue.assignees)
                  ? issue.assignees.map((a: any) => (typeof a === 'string' ? a : a.login))
                  : issue.assignees;
              }
              return cleaned;
            });
          } else {
            const cleaned = removeExcessiveFields(data);
            if (data.closed_at) cleaned.closed_at = data.closed_at;
            if (data.labels) {
              cleaned.labels = Array.isArray(data.labels)
                ? data.labels.map((l: any) => (typeof l === 'string' ? l : l.name))
                : data.labels;
            }
            if (data.assignees) {
              cleaned.assignees = Array.isArray(data.assignees)
                ? data.assignees.map((a: any) => (typeof a === 'string' ? a : a.login))
                : data.assignees;
            }
            return cleaned;
          }

        default:
          // 通用清洗
          if (Array.isArray(data)) {
            return data.map(removeExcessiveFields);
          } else {
            return removeExcessiveFields(data);
          }
      }
    } catch (error) {
      this.logger.log(`清洗数据时发生错误: ${error}`);
      return data; // 出错则返回原始数据
    }
  }

  // JSON 格式化输出
  private formatJsonOutput(data: any, pretty: boolean = true): string {
    if (pretty) {
      return JSON.stringify(data, null, 2);
    }
    return JSON.stringify(data);
  }

  // "人类可读"格式化示例
  private formatForHumans(data: any, type: string): string {
    try {
      switch (type) {
        case 'repository':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何仓库。";
            let result = `找到 ${data.length} 个仓库:\n\n`;
            data.forEach((repo, index) => {
              result += `${index + 1}. ${repo.full_name || repo.name}\n`;
              if (repo.description) result += `   描述: ${repo.description}\n`;
              result += `   链接: ${repo.html_url}\n`;
              if (repo.language) result += `   主要语言: ${repo.language}\n`;
              if (repo.stars) result += `   星标数: ${repo.stars}\n`;
              if (repo.belongsTo) result += `   仓库所有者: ${repo.belongsTo}\n`;
              result += `   更新于: ${new Date(repo.updated_at).toLocaleString()}\n\n`;
            });
            return result;
          } else {
            let result = `仓库: ${data.full_name || data.name}\n`;
            if (data.description) result += `描述: ${data.description}\n`;
            result += `链接: ${data.html_url}\n`;
            if (data.language) result += `主要语言: ${data.language}\n`;
            if (data.stars) result += `星标数: ${data.stars}\n`;
            result += `更新于: ${new Date(data.updated_at).toLocaleString()}\n`;
            return result;
          }

        case 'pull_request':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何拉取请求。";
            let result = `找到 ${data.length} 个拉取请求:\n\n`;
            data.forEach((pr, index) => {
              result += `${index + 1}. [${pr.state === 'open' ? '开放' : '关闭'}] #${pr.number}: ${pr.title}\n`;
              if (pr.user) result += `   创建者: ${pr.user}\n`;
              if (pr.created_at) result += `   创建于: ${new Date(pr.created_at).toLocaleString()}\n`;
              if (pr.merged !== undefined) result += `   已合并: ${pr.merged ? '是' : '否'}\n`;
              if (pr.merged_at) result += `   合并于: ${new Date(pr.merged_at).toLocaleString()}\n`;
              result += `   链接: ${pr.html_url}\n\n`;
            });
            return result;
          } else {
            let result = `拉取请求 #${data.number}: ${data.title}\n`;
            result += `状态: ${data.state === 'open' ? '开放' : '关闭'}\n`;
            if (data.user) result += `创建者: ${data.user}\n`;
            if (data.created_at) result += `创建于: ${new Date(data.created_at).toLocaleString()}\n`;
            if (data.merged !== undefined) result += `已合并: ${data.merged ? '是' : '否'}\n`;
            if (data.merged_at) result += `合并于: ${new Date(data.merged_at).toLocaleString()}\n`;
            result += `链接: ${data.html_url}\n`;
            return result;
          }

        case 'issue':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何议题。";
            let result = `找到 ${data.length} 个议题:\n\n`;
            data.forEach((issue, index) => {
              result += `${index + 1}. [${issue.state === 'open' ? '开放' : '关闭'}] #${issue.number}: ${issue.title}\n`;
              if (issue.user) result += `   创建者: ${issue.user}\n`;
              if (issue.created_at) result += `   创建于: ${new Date(issue.created_at).toLocaleString()}\n`;
              if (issue.closed_at) result += `   关闭于: ${new Date(issue.closed_at).toLocaleString()}\n`;
              result += `   链接: ${issue.html_url}\n\n`;
            });
            return result;
          } else {
            let result = `议题 #${data.number}: ${data.title}\n`;
            result += `状态: ${data.state === 'open' ? '开放' : '关闭'}\n`;
            if (data.user) result += `创建者: ${data.user}\n`;
            if (data.created_at) result += `创建于: ${new Date(data.created_at).toLocaleString()}\n`;
            if (data.closed_at) result += `关闭于: ${new Date(data.closed_at).toLocaleString()}\n`;
            result += `链接: ${data.html_url}\n`;
            return result;
          }

        default:
          // 其他类型直接 JSON
          return this.formatJsonOutput(data);
      }
    } catch (error) {
      this.logger.log(`格式化数据时发生错误: ${error}`);
      return this.formatJsonOutput(data);
    }
  }

  public async run(): Promise<void> {
    this.logger.log("GitHub MCP 服务器正在启动...");
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.log("GitHub MCP 服务器已连接");

    // 启动后进行一次简单的测试
    this.logger.log("开始测试 GitHub API...");
    try {
      this.logger.log("尝试获取用户信息...");
      const userResult = await this.octokit.rest.users.getAuthenticated();
      this.logger.log(`用户信息获取成功: ${JSON.stringify(userResult.data, null, 2)}`);

      this.logger.log("尝试列出仓库...");
      const reposResult = await this.octokit.rest.repos.listForAuthenticatedUser({
        visibility: 'all',
        per_page: 1
      });
      this.logger.log(`仓库列表获取成功，数量: ${reposResult.data.length}`);
      if (reposResult.data.length > 0) {
        const firstRepo = reposResult.data[0];
        this.logger.log(`示例仓库: ${JSON.stringify(firstRepo, null, 2)}`);
        this.logger.log("测试数据清洗和格式化功能...");
        const cleanedRepo = this.cleanGitHubResponse(firstRepo, 'repository');
        this.logger.log(`清洗后的仓库数据:\n${this.formatForHumans(cleanedRepo, 'repository')}`);
      }
    } catch (error: any) {
      this.logger.log(`API 测试错误: ${error}`);
      if (error.response) {
        this.logger.log(`状态码: ${error.response.status}`);
        this.logger.log(`响应头: ${JSON.stringify(error.response.headers, null, 2)}`);
        this.logger.log(`响应体: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      if (error.request) {
        this.logger.log(`请求配置: ${JSON.stringify(error.request, null, 2)}`);
      }
    }
  }
}

// 创建并运行 MCP 实例
const githubMCP = new GitHubMCP();
githubMCP.run().catch(console.error);
    
    
    
    
    