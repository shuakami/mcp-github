#!/usr/bin/env node

import { Octokit } from 'octokit';
import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

class GitHubMCP {
  private octokit: Octokit;
  private server: McpServer;

  constructor() {
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
        perPage: z.number().optional()
      },
      async ({ type = 'all', sort = 'updated', direction, perPage = 100 }) => {
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
          // 格式化为人类可读
          const text = this.formatForHumans(cleanedData, 'repository');
          return { content: [{ type: "text", text }] };
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
        archived: z.boolean().optional()
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

          const result = await this.octokit.rest.repos.update(params);
          // 清洗 & 格式化
          const cleanedData = this.cleanGitHubResponse(result.data, 'repository');
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
          const cleanedData = this.cleanGitHubResponse(result.data, '');
          const text = this.formatForHumans(cleanedData, 'repository');
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
      return data; // 出错则返回原始数据
    }
  }

  // 保留 formatForHumans 方法作为唯一的格式化方法
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
      // 发生错误时，尝试基础的格式化
      return `数据:\n${JSON.stringify(data, null, 2)}`;
    }
  }

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // 初始化完成
    console.log("GitHub MCP server started");
  }
}

// 创建并运行 MCP 实例
const githubMCP = new GitHubMCP();
githubMCP.run().catch(console.error);
    
    
    
    
    