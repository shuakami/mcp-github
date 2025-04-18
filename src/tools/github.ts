#!/usr/bin/env node

import { Octokit } from 'octokit';
import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 锁文件路径配置
const LOCK_FILE = path.join(process.cwd(), '.mcp-qq.lock');

class ProcessManager {
  private instanceId: string;

  constructor() {
    // 生成唯一实例ID，使用时间戳和随机数组合
    this.instanceId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // 注册进程退出处理
    this.registerCleanup();
  }

  private registerCleanup(): void {
    const cleanup = () => {
      try {
        if (fs.existsSync(LOCK_FILE)) {
          const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
          // 只清理自己的锁文件
          if (lockData.instanceId === this.instanceId) {
            fs.unlinkSync(LOCK_FILE);
            console.log('已清理锁文件');
          }
        }
      } catch (error) {
        console.error('清理锁文件时出错:', error);
      }
      process.exit(0);
    };

    // 注册多个信号以确保清理
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }

  public checkAndCreateLock(): boolean {
    try {
      // 检查锁文件是否存在
      if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        
        try {
          // 检查进程是否还在运行
          process.kill(lockData.pid, 0);
          console.log('发现正在运行的实例，发送终止信号');
          // 如果进程还在运行，发送终止信号
          process.kill(lockData.pid, 'SIGTERM');
          // 等待一段时间确保旧进程退出
          setTimeout(() => {
            this.createLockFile();
          }, 1000);
          return true;
        } catch (e) {
          // 进程不存在，可以继续
          console.log('发现过期的锁文件，将创建新的锁文件');
          this.createLockFile();
          return true;
        }
      }

      // 创建新的锁文件
      console.log('创建新的锁文件');
      this.createLockFile();
      return true;
    } catch (error) {
      console.error('处理锁文件时出错:', error);
      return false;
    }
  }

  private createLockFile(): void {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      instanceId: this.instanceId,
      timestamp: Date.now()
    }));
  }
}

class GitHubMCP {
  private octokit: Octokit;
  private server: McpServer;
  private processManager: ProcessManager;

  constructor() {
    // 初始化进程管理器
    this.processManager = new ProcessManager();
    
    // 检查进程锁
    if (!this.processManager.checkAndCreateLock()) {
      console.error('无法创建进程锁，程序退出');
      process.exit(1);
    }

    // 从环境变量中读取token，如果不存在则使用后备token
    const token = process.env.GITHUB_TOKEN || '';
    
    // 初始化 Octokit
    this.octokit = new Octokit({
      auth: token,
      timeZone: 'UTC',
      baseUrl: 'https://api.github.com',
      previews: ['machine-man-preview'],
      request: {
        timeout: 5000
      }
    });

    // 初始化 MCP Server
    this.server = new McpServer({
      name: "github-mcp",
      version: "1.0.0"
    });

    // 注册所有工具
    this.registerTools();
  }

  private registerTools(): void {
    // 基础：仓库操作
    this.registerRepositoryTools();
    // 分支操作
    this.registerBranchTools();
    // PR 操作
    this.registerPullRequestTools();
    // Issue 操作
    this.registerIssueTools();
    // 用户/社交操作 (仅保留关键工具)
    this.registerUserTools();
    // 代码管理（文件/提交）
    this.registerCodeManagementTools();
    // Releases 管理
    this.registerReleasesTools();
  }

  /**
   * =================
   *  1. 仓库相关工具
   * =================
   */
  private registerRepositoryTools(): void {
    // List repositories
    this.server.tool(
      "listRepositories",
      {
        type: z.enum(['all', 'owner', 'public', 'private', 'member']).optional(),
        sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
        direction: z.enum(['asc', 'desc']).optional(),
        perPage: z.number().optional(),
        page: z.number().optional(),
        search: z.string().optional()
      },
      async ({ type = 'all', sort = 'updated', direction = 'desc', perPage = 30, page = 1, search }) => {
        try {
          const params = {
            type,
            sort,
            direction,
            per_page: perPage,
            page
          };

          // 执行API请求获取仓库列表
          const result = await this.octokit.rest.repos.listForAuthenticatedUser(params);
          
          // 获取仓库总数（若API支持）
          let totalCount = result.data.length;
          if (result.headers && result.headers['link']) {
            const linkHeader = result.headers['link'];
            // 提取总页数
            const lastPageMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (lastPageMatch) {
              const lastPage = parseInt(lastPageMatch[1]);
              // 估算总数
              totalCount = (lastPage - 1) * perPage + result.data.length;
            }
          }
          
          // 处理搜索功能
          let filteredData = result.data;
          if (search && search.trim()) {
            const searchLower = search.toLowerCase().trim();
            filteredData = filteredData.filter(repo => {
              return (
                (repo.name && repo.name.toLowerCase().includes(searchLower)) ||
                (repo.full_name && repo.full_name.toLowerCase().includes(searchLower)) ||
                (repo.description && repo.description.toLowerCase().includes(searchLower)) ||
                (repo.language && repo.language.toLowerCase().includes(searchLower)) ||
                (repo.topics && repo.topics.some(topic => topic.toLowerCase().includes(searchLower)))
              );
            });
          }
          
          // 清洗数据
          const cleanedData = this.cleanGitHubResponse(filteredData, 'repository');
          
          // 构建分页信息
          const paginationInfo = {
            current_page: page,
            items_per_page: perPage,
            total_items: search ? filteredData.length : totalCount,
            has_next_page: result.data.length === perPage,
            has_prev_page: page > 1
          };
          
          // 构建输出
          let formattedText = '';
          
          if (search) {
            formattedText = `搜索 "${search}" 结果: 找到 ${filteredData.length} 个仓库\n\n`;
          } else {
            formattedText = `仓库列表 (第 ${page} 页, 共 ${perPage} 个/页)\n\n`;
          }
          
          // 使用现有的格式化方法
          formattedText += this.formatForHumans(cleanedData, 'repository');
          
          // 添加分页导航提示
          formattedText += `\n--- 分页导航 ---\n`;
          formattedText += `当前页: ${page}\n`;
          
          if (paginationInfo.has_prev_page) {
            formattedText += `上一页: 使用 page: ${page - 1} 查看前一页\n`;
          }
          
          if (paginationInfo.has_next_page) {
            formattedText += `下一页: 使用 page: ${page + 1} 查看下一页\n`;
          }
          
          if (search) {
            formattedText += `提示: 要查看所有仓库，请移除 search 参数\n`;
          } else {
            formattedText += `提示: 使用 search 参数可以按名称、描述或语言搜索仓库\n`;
          }
          
          return { content: [{ type: "text", text: formattedText }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.get({
            owner,
            repo,
          });
          // 清洗 & 格式化
          const cleanedData = this.cleanGitHubResponse(result.data, 'repository');
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        archived: z.boolean().optional(),
        topics: z.array(z.string()).optional()
      },
      async ({ owner, repo, ...data }) => {
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

          // 如果提供了topics，使用单独的API调用来更新topics
          let topicsResult;
          if (data.topics !== undefined) {
            try {
              topicsResult = await this.octokit.rest.repos.replaceAllTopics({
                owner,
                repo,
                names: data.topics
              });
            } catch (topicsError: any) {
              console.error(`更新主题标签出错: ${topicsError.message}`);
              // 继续执行其他更新，不因topics更新失败而中断整个操作
            }
          }

          // 如果没有其他参数需要更新，直接返回带topics的仓库信息
          if (Object.keys(params).length <= 2 && topicsResult) { // 只有owner和repo
            // 获取最新的仓库信息
            const getResult = await this.octokit.rest.repos.get({
              owner,
              repo
            });
            
            let cleanedData = this.cleanGitHubResponse(getResult.data, 'repository');
            
            // 添加topics信息
            if (topicsResult && topicsResult.data.names) {
              cleanedData.topics = topicsResult.data.names;
            }
            
            const text = this.formatForHumans(cleanedData, 'repository');
            return { content: [{ type: "text", text }] };
          }

          // 有其他属性需要更新
          const result = await this.octokit.rest.repos.update(params);
          
          // 清洗 & 格式化
          let cleanedData = this.cleanGitHubResponse(result.data, 'repository');
          
          // 如果更新了topics，将topics信息添加到返回结果中
          if (topicsResult && topicsResult.data.names) {
            cleanedData.topics = topicsResult.data.names;
          }
          
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          await this.octokit.rest.repos.delete({
            owner,
            repo
          });
          return { content: [{ type: "text", text: `Repository ${owner}/${repo} has been deleted.` }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.listContributors({
            owner,
            repo,
            anon: anon ? "1" : undefined,
            per_page: perPage
          });
          // 清洗 & 格式化（通用类型，就用默认清洗）
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha,
          });
          // 清洗 & 格式化（通用类型）
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.getBranch({
            owner,
            repo,
            branch
          });
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.listBranches({
            owner,
            repo,
            protected: isProtected,
            per_page: perPage
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'branch');
          const text = this.formatForHumans(cleanedData, 'branch');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          await this.octokit.rest.git.deleteRef({
            owner,
            repo,
            ref: `heads/${branch}`
          });
          return { content: [{ type: "text", text: `Branch ${branch} has been deleted from ${owner}/${repo}.` }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'pull_request');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'pull_request');
          const text = this.formatForHumans(cleanedData, 'pull_request');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'pull_request');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'pull_request');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(result.data, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Get pull request comments
    this.server.tool(
      "getPullRequestComments",
      {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
        page: z.number().optional()
      },
      async ({ owner, repo, pullNumber, page = 1 }) => {
        try {
          // 获取 PR 本身的信息，以便在结果中包含
          const prResult = await this.octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber
          });
          const prData = this.cleanGitHubResponse(prResult.data, 'pull_request');
          
          // 定义评论接口类型
          interface BaseComment {
            id: any;
            type: string;
            user: string;
            created_at: string;
            updated_at: string;
            body: string;
            html_url: string;
          }
          
          interface IssueComment extends BaseComment {
            type: 'issue_comment';
          }
          
          interface ReviewComment extends BaseComment {
            type: 'review_comment';
            path?: string;
            line?: number;
            position?: number;
            commit_id?: string;
          }
          
          type PrComment = IssueComment | ReviewComment;
          
          // 先获取 PR 的常规评论（类似 issue 评论）
          const issueCommentsResult = await this.octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: pullNumber,
            per_page: 20,
            page
          });
          
          // 获取 PR 的代码审查评论
          const reviewCommentsResult = await this.octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 20,
            page
          });
          
          // 清洗常规评论数据
          const issueComments: IssueComment[] = issueCommentsResult.data.map((comment: any) => {
            return {
              id: comment.id,
              type: 'issue_comment',
              user: comment.user?.login || 'unknown',
              created_at: comment.created_at,
              updated_at: comment.updated_at,
              body: comment.body,
              html_url: comment.html_url
            };
          });
          
          // 清洗代码审查评论数据
          const reviewComments: ReviewComment[] = reviewCommentsResult.data.map((comment: any) => {
            return {
              id: comment.id,
              type: 'review_comment',
              user: comment.user?.login || 'unknown',
              created_at: comment.created_at,
              updated_at: comment.updated_at,
              body: comment.body,
              html_url: comment.html_url,
              path: comment.path,
              line: comment.line,
              position: comment.position,
              commit_id: comment.commit_id
            };
          });
          
          // 将两种评论合并并按时间排序
          const allComments: PrComment[] = [...issueComments, ...reviewComments].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          
          // 构建分页信息
          const hasMoreIssueComments = issueCommentsResult.data.length >= 20;
          const hasMoreReviewComments = reviewCommentsResult.data.length >= 20;
          const pagination = {
            current_page: page,
            total_comments: allComments.length,
            has_next_page: hasMoreIssueComments || hasMoreReviewComments,
            next_page: (hasMoreIssueComments || hasMoreReviewComments) ? page + 1 : null
          };
          
          // 构建人类可读的输出
          let result = `PR #${prData.number}: ${prData.title}\n`;
          result += `状态: ${prData.state === 'open' ? '开放' : '关闭'}\n`;
          result += `创建者: ${prData.user || 'unknown'}\n`;
          result += `创建于: ${new Date(prData.created_at).toLocaleString()}\n`;
          if (prData.merged !== undefined) {
            result += `已合并: ${prData.merged ? '是' : '否'}\n`;
          }
          if (prData.merged_at) {
            result += `合并于: ${new Date(prData.merged_at).toLocaleString()}\n`;
          }
          result += `从分支 ${prData.head_branch || '未知'} 到 ${prData.base_branch || '未知'}\n`;
          result += `链接: ${prData.html_url}\n\n`;
          
          if (prData.body) {
            result += `描述:\n${prData.body}\n\n`;
          }
          
          result += `--- 评论 (第 ${page} 页) ---\n\n`;
          
          if (allComments.length === 0) {
            result += "没有评论。\n";
          } else {
            allComments.forEach((comment, index) => {
              const commentType = comment.type === 'issue_comment' ? '常规评论' : '代码审查评论';
              result += `[${index + 1}] ${comment.user} 在 ${new Date(comment.created_at).toLocaleString()} 添加了${commentType}:\n`;
              
              // 对于代码审查评论，添加文件和位置信息
              if (comment.type === 'review_comment' && 'path' in comment && comment.path) {
                result += `文件: ${comment.path}`;
                if ('line' in comment && comment.line) {
                  result += `, 行: ${comment.line}`;
                }
                result += `\n`;
              }
              
              result += `${comment.body}\n\n`;
            });
            
            // 添加分页提示
            if (pagination.has_next_page) {
              result += `\n--- 还有更多评论。使用 page: ${pagination.next_page} 查看下一页 ---\n`;
            }
          }
          
          return { content: [{ type: "text", text: result }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Create pull request comment (regular comment, not code review)
    this.server.tool(
      "createPullRequestComment",
      {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
        body: z.string()
      },
      async ({ owner, repo, pullNumber, body }) => {
        try {
          // PR 的常规评论使用 issues.createComment API，因为 PR 也是一种特殊的 Issue
          const result = await this.octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body
          });
          
          // 清洗评论数据
          const commentData = {
            id: result.data.id,
            user: result.data.user?.login || 'unknown',
            created_at: result.data.created_at,
            updated_at: result.data.updated_at,
            body: result.data.body,
            html_url: result.data.html_url
          };
          
          // 构建人类可读的输出
          let responseText = `已成功在 PR #${pullNumber} 下添加评论:\n\n`;
          responseText += `评论者: ${commentData.user}\n`;
          responseText += `创建于: ${new Date(commentData.created_at).toLocaleString()}\n`;
          responseText += `评论内容:\n${commentData.body}\n\n`;
          responseText += `评论链接: ${commentData.html_url}`;
          
          return { content: [{ type: "text", text: responseText }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Create pull request review comment (code review comment on specific file/line)
    this.server.tool(
      "createPullRequestReviewComment",
      {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
        body: z.string(),
        commitId: z.string(),
        path: z.string(),
        line: z.number(),
        startLine: z.number().optional(),
        startSide: z.enum(['LEFT', 'RIGHT']).optional(),
        side: z.enum(['LEFT', 'RIGHT']).optional(),
      },
      async ({ owner, repo, pullNumber, body, commitId, path, line, startLine, startSide, side = 'RIGHT' }) => {
        try {
          // 构建请求参数
          const params: any = {
            owner,
            repo,
            pull_number: pullNumber,
            body,
            commit_id: commitId,
            path,
            line,
            side
          };
          
          // 添加可选参数
          if (startLine) params.start_line = startLine;
          if (startSide) params.start_side = startSide;
          
          // 创建代码审查评论
          const result = await this.octokit.rest.pulls.createReviewComment(params);
          
          // 清洗评论数据
          const commentData = {
            id: result.data.id,
            user: result.data.user?.login || 'unknown',
            created_at: result.data.created_at,
            updated_at: result.data.updated_at,
            body: result.data.body,
            html_url: result.data.html_url,
            path: result.data.path,
            line: result.data.line,
            commit_id: result.data.commit_id
          };
          
          // 构建人类可读的输出
          let responseText = `已成功在 PR #${pullNumber} 的代码中添加评论:\n\n`;
          responseText += `评论者: ${commentData.user}\n`;
          responseText += `文件: ${commentData.path}\n`;
          responseText += `行号: ${commentData.line}\n`;
          responseText += `创建于: ${new Date(commentData.created_at).toLocaleString()}\n`;
          responseText += `评论内容:\n${commentData.body}\n\n`;
          responseText += `评论链接: ${commentData.html_url}`;
          
          return { content: [{ type: "text", text: responseText }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'issue');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatForHumans(cleanedData, 'issue');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'issue');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'issue');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            state: 'closed'
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'issue');
          const text = this.formatForHumans(cleanedData, 'issue');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Get issue comments
    this.server.tool(
      "getIssueComments",
      {
        owner: z.string(),
        repo: z.string(),
        issueNumber: z.number(),
        page: z.number().optional()
      },
      async ({ owner, repo, issueNumber, page = 1 }) => {
        try {
          // 获取 issue 本身的信息，以便在结果中包含
          const issueResult = await this.octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber
          });
          const issueData = this.cleanGitHubResponse(issueResult.data, 'issue');
          
          // 获取评论
          const commentsResult = await this.octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: issueNumber,
            per_page: 30,
            page
          });
          
          // 清洗评论数据
          const commentsData = commentsResult.data.map((comment: any) => {
            return {
              id: comment.id,
              user: comment.user?.login || 'unknown',
              created_at: comment.created_at,
              updated_at: comment.updated_at,
              body: comment.body,
              html_url: comment.html_url
            };
          });
          
          // 构建分页信息
          const pagination = {
            current_page: page,
            total_comments: commentsResult.data.length >= 30 ? '30+' : commentsResult.data.length,
            has_next_page: commentsResult.data.length >= 30,
            next_page: commentsResult.data.length >= 30 ? page + 1 : null
          };
          
          // 构建人类可读的输出
          let result = `Issue #${issueData.number}: ${issueData.title}\n`;
          result += `状态: ${issueData.state === 'open' ? '开放' : '关闭'}\n`;
          result += `创建者: ${issueData.user || 'unknown'}\n`;
          result += `创建于: ${new Date(issueData.created_at).toLocaleString()}\n`;
          result += `链接: ${issueData.html_url}\n\n`;
          
          if (issueData.body) {
            result += `描述:\n${issueData.body}\n\n`;
          }
          
          result += `--- 评论 (第 ${page} 页) ---\n\n`;
          
          if (commentsData.length === 0) {
            result += "没有评论。\n";
          } else {
            commentsData.forEach((comment, index) => {
              result += `[${index + 1}] ${comment.user} 在 ${new Date(comment.created_at).toLocaleString()} 评论:\n`;
              result += `${comment.body}\n\n`;
            });
            
            // 添加分页提示
            if (pagination.has_next_page) {
              result += `\n--- 还有更多评论。使用 page: ${pagination.next_page} 查看下一页 ---\n`;
            }
          }
          
          return { content: [{ type: "text", text: result }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // Create issue comment
    this.server.tool(
      "createIssueComment",
      {
        owner: z.string(),
        repo: z.string(),
        issueNumber: z.number(),
        body: z.string()
      },
      async ({ owner, repo, issueNumber, body }) => {
        try {
          const result = await this.octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body
          });
          
          // 清洗评论数据
          const commentData = {
            id: result.data.id,
            user: result.data.user?.login || 'unknown',
            created_at: result.data.created_at,
            updated_at: result.data.updated_at,
            body: result.data.body,
            html_url: result.data.html_url
          };
          
          // 构建人类可读的输出
          let responseText = `已成功在 Issue #${issueNumber} 下添加评论:\n\n`;
          responseText += `评论者: ${commentData.user}\n`;
          responseText += `创建于: ${new Date(commentData.created_at).toLocaleString()}\n`;
          responseText += `评论内容:\n${commentData.body}\n\n`;
          responseText += `评论链接: ${commentData.html_url}`;
          
          return { content: [{ type: "text", text: responseText }] };
        } catch (error: any) {
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
    // 列出某用户关注的人
    this.server.tool(
      "listFollowing",
      {
        username: z.string(),
        perPage: z.number().optional()
      },
      async ({ username, perPage = 100 }) => {
        try {
          // 列出用户所关注的所有人
          const followingResult = await this.octokit.rest.users.listFollowingForUser({
            username,
            per_page: perPage
          });
          const followingList = followingResult.data;

          if (!followingList || followingList.length === 0) {
            return { content: [{ type: "text", text: `用户 ${username} 没有关注任何人。` }] };
          }

          // 清洗数据
          const cleanedList = this.cleanGitHubResponse(followingList, 'user');

          // 格式化为人类可读
          let result = `用户 ${username} 关注了以下 ${cleanedList.length} 个用户:\n\n`;
          cleanedList.forEach((user: any, index: number) => {
            result += `${index + 1}. ${user.login || user.name}\n`;
            if (user.html_url) result += `   主页: ${user.html_url}\n`;
            if (user.description) result += `   描述: ${user.description}\n`;
            result += `\n`;
          });
          return { content: [{ type: "text", text: result }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出某用户关注的人下的所有仓库
    this.server.tool(
      "listFollowingUserRepos",
      {
        username: z.string(),
        perPage: z.number().optional()
      },
      async ({ username, perPage = 30 }) => {
        try {
          // 先列出用户所关注的所有人
          const followingResult = await this.octokit.rest.users.listFollowingForUser({
            username,
            per_page: perPage
          });
          const followingList = followingResult.data;

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

          const text = this.formatForHumans(allRepos, 'repository');
          return { content: [{ type: "text", text: text }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );

    // 列出和指定用户交流最频繁的其它用户
    this.server.tool(
      "listFrequentCommunicators",
      {
        username: z.string(),
        repoPerPage: z.number().optional(),
        issuePerPage: z.number().optional(),
        commentPerPage: z.number().optional()
      },
      async ({ username, repoPerPage = 5, issuePerPage = 5, commentPerPage = 5 }) => {
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
                  // 忽略获取PR评论错误
                }
              }
            } catch (prError) {
              // 忽略获取仓库PR错误
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
            // 忽略检查用户互动PR错误
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

          let result = `用户 ${username} 的仓库中最常与之互动的其他用户（已过滤机器人）：\n\n`;
          filteredSorted.forEach((item, index) => {
            result += `${index + 1}. 用户: ${item.user}, 互动次数: ${item.count}\n`;
          });
          return { content: [{ type: "text", text: result }] };
        } catch (error: any) {
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
    // 列出仓库目录内容
    this.server.tool(
      "listRepositoryContents",
      {
        owner: z.string(),
        repo: z.string(),
        path: z.string().optional(),
        ref: z.string().optional()  // 分支或提交 SHA，可选
      },
      async ({ owner, repo, path = "", ref }) => {
        try {
          const result = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref
          });

          // 判断结果类型
          if (Array.isArray(result.data)) {
            // 如果是目录，会返回一个数组
            const items = result.data.map((item: any) => {
              const isDir = item.type === 'dir';
              const icon = isDir ? '📁' : item.type === 'file' ? '📄' : item.type === 'symlink' ? '🔗' : '❓';
              const size = item.size ? `(${this.formatFileSize(item.size)})` : '';
              return `${icon} ${item.name} ${size} ${isDir ? '/' : ''}`;
            }).join('\n');
            
            // 构建导航路径信息
            const pathParts = path.split('/').filter(p => p);
            let pathNav = '📂 根目录';
            if (pathParts.length > 0) {
              pathNav = `📂 根目录/${pathParts.join('/')}`;
            }
            
            // 提供导航提示
            const parentPath = pathParts.length > 0 
              ? pathParts.slice(0, -1).join('/') 
              : '';
            const navigationTip = path 
              ? `\n\n提示：使用 path: "${parentPath}" 返回上级目录` 
              : '';

            return {
              content: [{
                type: "text",
                text: `仓库: ${owner}/${repo}${ref ? ` (分支: ${ref})` : ''}\n路径: ${pathNav}\n\n${items}${navigationTip}`
              }]
            };
          } else {
            // 单个文件，显示文件信息
            const fileData = result.data;
            return {
              content: [{
                type: "text",
                text: `文件: ${fileData.name}\n大小: ${this.formatFileSize(fileData.size)}\n类型: ${fileData.type}\n路径: ${fileData.path}\n\n如需查看文件内容，请使用 getFileContent 工具。`
              }]
            };
          }
        } catch (error: any) {
          // 友好的错误处理
          if (error.status === 404) {
            return { 
              content: [{ 
                type: "text", 
                text: `路径不存在: ${path || '/'}\n请检查路径是否正确，或尝试返回上级目录。` 
              }] 
            };
          }
          return { content: [{ type: "text", text: `错误: ${error.message}` }] };
        }
      }
    );

    // 获取文件内容
    this.server.tool(
      "getFileContent",
      {
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        ref: z.string().optional(),  // 分支或提交 SHA，可选
        startLine: z.number().optional(), // 开始行号（从1开始）
        endLine: z.number().optional()    // 结束行号
      },
      async ({ owner, repo, path, ref, startLine, endLine }) => {
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
                text: `目标路径是一个目录，包含以下内容:\n\n${this.formatForHumans(result.data, 'repository')}`
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
          
          // 分割为行
          const lines = decodedContent.split('\n');
          const totalLines = lines.length;
          
          // 处理指定行范围
          if (startLine !== undefined) {
            // 确保行号在有效范围内
            const validStartLine = Math.max(1, Math.min(startLine, totalLines));
            const validEndLine = endLine 
              ? Math.min(endLine, totalLines) 
              : Math.min(validStartLine + 199, totalLines); // 默认显示最多200行
            
            // 提取指定的行范围
            const selectedLines = lines.slice(validStartLine - 1, validEndLine);
            
            // 构建显示内容
            let content = selectedLines.join('\n');
            
            // 添加行范围信息
            let rangeInfo = `文件: ${path}\n` +
                           `显示第 ${validStartLine} 至 ${validEndLine} 行 (共 ${totalLines} 行)\n\n`;
            
            // 添加继续阅读的提示（如果有更多行）
            if (validEndLine < totalLines) {
              rangeInfo += `\n\n提示: 使用 startLine: ${validEndLine + 1} 继续阅读后续内容`;
            }
            
            // 添加前面内容的提示（如果不是从第一行开始）
            if (validStartLine > 1) {
              rangeInfo += `\n提示: 使用 startLine: 1, endLine: ${validStartLine - 1} 查看之前的内容`;
            }
            
            return { 
              content: [{
                type: "text",
                text: `${rangeInfo}${content}`
              }]
            };
          } else {
            // 未指定行号，使用默认行为（截断长内容）
            const truncated = decodedContent.length > 2000 
              ? decodedContent.substring(0, 2000) + "\n...（内容过长，已截断）\n\n提示: 使用 startLine 和 endLine 参数查看特定行范围" 
              : decodedContent;

            return { 
              content: [{
                type: "text",
                text: `文件内容 (base64解码后${decodedContent.length > 2000 ? ', 已截断' : ''}):\n\n${truncated}`
              }]
            };
          }
        } catch (error: any) {
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
          const text = this.formatForHumans(result.data, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.getCommit({
            owner,
            repo,
            ref
          });
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
        } catch (error:any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * ============================
   *  Releases 相关工具
   * ============================
   */
  private registerReleasesTools(): void {
    // 列出仓库所有 Tag
    this.server.tool(
      "listTags",
      {
        owner: z.string(),
        repo: z.string(),
        perPage: z.number().optional()
      },
      async ({ owner, repo, perPage = 30 }) => {
        try {
          const result = await this.octokit.rest.repos.listTags({
            owner,
            repo,
            per_page: perPage
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'tag');
          const text = this.formatForHumans(cleanedData, 'tag');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const cleanedData = this.cleanGitHubResponse(result.data, 'release');
          const text = this.formatForHumans(cleanedData, 'release');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.listReleases({
            owner,
            repo,
            per_page: perPage
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'release');
          const text = this.formatForHumans(cleanedData, 'release');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          const result = await this.octokit.rest.repos.getRelease({
            owner,
            repo,
            release_id: releaseId
          });
          const cleanedData = this.cleanGitHubResponse(result.data, 'release');
          const text = this.formatForHumans(cleanedData, 'release');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
          const cleanedData = this.cleanGitHubResponse(result.data, 'release');
          const text = this.formatForHumans(cleanedData, 'release');
          return { content: [{ type: "text", text }] };
        } catch (error: any) {
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
        try {
          await this.octokit.rest.repos.deleteRelease({
            owner,
            repo,
            release_id: releaseId
          });
          return { content: [{ type: "text", text: `Release #${releaseId} 已删除。` }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
      }
    );
  }

  // ----------------------
  // 统一的清洗函数
  // ----------------------
  private cleanGitHubResponse(data: any, type: string): any {
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
          'sha',
          'protected',
          'protection',
          'commit',
          'tag_name',
          'target_commitish',
          'prerelease',
          'draft',
          'assets_url',
          'upload_url',
          'published_at'
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
        case 'branch':
          if (Array.isArray(data)) {
            return data.map(branch => {
              const cleaned = removeExcessiveFields(branch);
              cleaned.name = branch.name;
              cleaned.protected = branch.protected;
              if (branch.commit && branch.commit.sha) {
                cleaned.commit_sha = branch.commit.sha;
              }
              if (branch.protection) {
                cleaned.protection_enabled = true;
                cleaned.protection_details = branch.protection;
              }
              return cleaned;
            });
          } else {
            const cleaned = removeExcessiveFields(data);
            cleaned.name = data.name;
            cleaned.protected = data.protected;
            if (data.commit && data.commit.sha) {
              cleaned.commit_sha = data.commit.sha;
            }
            if (data.protection) {
              cleaned.protection_enabled = true;
              cleaned.protection_details = data.protection;
            }
            return cleaned;
          }

        case 'repository':
          if (Array.isArray(data)) {
            return data.map(repo => {
              const cleaned = removeExcessiveFields(repo);
              // 确保关键字段被保留
              cleaned.html_url = repo.html_url || cleaned.html_url;
              cleaned.updated_at = repo.updated_at || cleaned.updated_at;
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
            // 确保关键字段被保留
            cleaned.html_url = data.html_url || cleaned.html_url;
            cleaned.updated_at = data.updated_at || cleaned.updated_at;
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

        case 'tag':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何标签。";
            let result = `找到 ${data.length} 个标签:\n\n`;
            data.forEach((tag, index) => {
              result += `${index + 1}. ${tag.name}\n`;
              if (tag.commit && tag.commit.sha) {
                result += `   提交: ${tag.commit.sha.substring(0, 7)}\n`;
              }
              result += '\n';
            });
            return result;
          } else {
            let result = `标签: ${data.name}\n`;
            if (data.commit && data.commit.sha) {
              result += `提交: ${data.commit.sha.substring(0, 7)}\n`;
            }
            return result;
          }

        case 'release':
          if (Array.isArray(data)) {
            return data.map(release => {
              const cleaned = removeExcessiveFields(release);
              // 确保关键字段被保留
              cleaned.name = release.name;
              cleaned.tag_name = release.tag_name;
              cleaned.html_url = release.html_url;
              cleaned.body = release.body;
              cleaned.draft = release.draft;
              cleaned.prerelease = release.prerelease;
              cleaned.published_at = release.published_at;
              cleaned.assets_url = release.assets_url;
              cleaned.upload_url = release.upload_url;
              return cleaned;
            });
          } else {
            const cleaned = removeExcessiveFields(data);
            // 确保关键字段被保留
            cleaned.name = data.name;
            cleaned.tag_name = data.tag_name;
            cleaned.html_url = data.html_url;
            cleaned.body = data.body;
            cleaned.draft = data.draft;
            cleaned.prerelease = data.prerelease;
            cleaned.published_at = data.published_at;
            cleaned.assets_url = data.assets_url;
            cleaned.upload_url = data.upload_url;
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
      console.error('Data cleaning error:', error);
      return data; // 出错则返回原始数据
    }
  }

  // 保留 formatForHumans 方法作为唯一的格式化方法
  private formatForHumans(data: any, type: string): string {
    try {
      switch (type) {
        case 'branch':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何分支。";
            let result = `找到 ${data.length} 个分支:\n\n`;
            data.forEach((branch, index) => {
              result += `${index + 1}. ${branch.name}\n`;
              result += `   保护状态: ${branch.protected ? '已保护' : '未保护'}\n`;
              if (branch.commit_sha) {
                result += `   最新提交: ${branch.commit_sha.substring(0, 7)}\n`;
              }
              if (branch.protection_enabled) {
                result += `   保护规则: 已启用\n`;
              }
              result += '\n';
            });
            return result;
          } else {
            let result = `分支: ${data.name}\n`;
            result += `保护状态: ${data.protected ? '已保护' : '未保护'}\n`;
            if (data.commit_sha) {
              result += `最新提交: ${data.commit_sha.substring(0, 7)}\n`;
            }
            if (data.protection_enabled) {
              result += `保护规则: 已启用\n`;
            }
            return result;
          }

        case 'repository':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何仓库。";
            let result = `找到 ${data.length} 个仓库:\n\n`;
            data.forEach((repo, index) => {
              result += `${index + 1}. ${repo.full_name || repo.name}\n`;
              if (repo.description) result += `   描述: ${repo.description}\n`;
              result += `   链接: ${repo.html_url || '未提供'}\n`;
              if (repo.language) result += `   主要语言: ${repo.language}\n`;
              if (repo.stars) result += `   星标数: ${repo.stars}\n`;
              if (repo.belongsTo) result += `   仓库所有者: ${repo.belongsTo}\n`;
              if (repo.topics && repo.topics.length > 0) result += `   主题标签: ${repo.topics.join(', ')}\n`;
              // 添加日期格式化的错误处理
              const updateDate = repo.updated_at ? new Date(repo.updated_at) : null;
              result += `   更新于: ${updateDate && !isNaN(updateDate.getTime()) ? updateDate.toLocaleString() : '未知时间'}\n\n`;
            });
            return result;
          } else {
            let result = `仓库: ${data.full_name || data.name}\n`;
            if (data.description) result += `描述: ${data.description}\n`;
            result += `链接: ${data.html_url || '未提供'}\n`;
            if (data.language) result += `主要语言: ${data.language}\n`;
            if (data.stars) result += `星标数: ${data.stars}\n`;
            if (data.topics && data.topics.length > 0) result += `主题标签: ${data.topics.join(', ')}\n`;
            // 添加日期格式化的错误处理
            const updateDate = data.updated_at ? new Date(data.updated_at) : null;
            result += `更新于: ${updateDate && !isNaN(updateDate.getTime()) ? updateDate.toLocaleString() : '未知时间'}\n`;
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

        case 'user':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何用户。";
            let result = `找到 ${data.length} 个用户:\n\n`;
            data.forEach((user, index) => {
              result += `${index + 1}. ${user.login || user.name}\n`;
              if (user.html_url) result += `   主页: ${user.html_url}\n`;
              if (user.description) result += `   描述: ${user.description}\n`;
              result += `\n`;
            });
            return result;
          } else {
            let result = `用户: ${data.login || data.name}\n`;
            if (data.html_url) result += `主页: ${data.html_url}\n`;
            if (data.description) result += `描述: ${data.description}\n`;
            return result;
          }

        case 'tag':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何标签。";
            let result = `找到 ${data.length} 个标签:\n\n`;
            data.forEach((tag, index) => {
              result += `${index + 1}. ${tag.name}\n`;
              if (tag.commit && tag.commit.sha) {
                result += `   提交: ${tag.commit.sha.substring(0, 7)}\n`;
              }
              result += '\n';
            });
            return result;
          } else {
            let result = `标签: ${data.name}\n`;
            if (data.commit && data.commit.sha) {
              result += `提交: ${data.commit.sha.substring(0, 7)}\n`;
            }
            return result;
          }

        case 'release':
          if (Array.isArray(data)) {
            if (data.length === 0) return "未找到任何发布版本。";
            let result = `找到 ${data.length} 个发布版本:\n\n`;
            data.forEach((release, index) => {
              result += `${index + 1}. ${release.name || release.tag_name}\n`;
              if (release.draft) result += `   [草稿]\n`;
              if (release.prerelease) result += `   [预发布]\n`;
              if (release.published_at) {
                const publishDate = new Date(release.published_at);
                result += `   发布于: ${publishDate.toLocaleString()}\n`;
              }
              if (release.body) {
                const shortBody = release.body.length > 100 
                  ? release.body.substring(0, 100) + '...' 
                  : release.body;
                result += `   描述: ${shortBody}\n`;
              }
              result += `   链接: ${release.html_url || '未提供'}\n\n`;
            });
            return result;
          } else {
            let result = `发布版本: ${data.name || data.tag_name || '未命名'}\n`;
            if (data.draft) result += `状态: 草稿\n`;
            if (data.prerelease) result += `类型: 预发布\n`;
            if (data.published_at) {
              const publishDate = new Date(data.published_at);
              result += `发布于: ${publishDate.toLocaleString()}\n`;
            }
            if (data.body) result += `描述:\n${data.body}\n`;
            result += `链接: ${data.html_url || '未提供'}\n`;
            if (data.assets_url) result += `资源链接: ${data.assets_url}\n`;
            return result;
          }

        default:
          // 其他类型也使用人类可读格式
          if (Array.isArray(data)) {
            return `数据列表:\n\n${data.map((item, index) => 
              `${index + 1}. ${Object.entries(item)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n   ')}\n`
            ).join('\n')}`;
          } else {
            return `数据详情:\n\n${Object.entries(data)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')}\n`;
          }
      }
    } catch (error) {
      console.error('Formatting error:', error);
      // 发生错误时，尝试基础的格式化
      return `数据:\n${JSON.stringify(data, null, 2)}`;
    }
  }

  /**
   * 格式化文件大小显示
   * @param bytes 文件大小（字节）
   * @returns 格式化后的大小字符串（如 1.5KB, 3.2MB）
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  public async run(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      // 初始化完成
      console.log("GitHub MCP server started");
    } catch (error) {
      console.error('启动服务器时出错:', error);
      process.exit(1);
    }
  }
}

// 创建并运行 MCP 实例
const githubMCP = new GitHubMCP();
githubMCP.run().catch(error => {
  console.error('运行时出错:', error);
  process.exit(1);
});
    
    
    
    
    