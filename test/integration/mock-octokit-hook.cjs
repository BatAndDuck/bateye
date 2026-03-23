const fs = require('node:fs');
const Module = require('node:module');

function readFixtures() {
  const fixturePath = process.env.BATEYE_OCTOKIT_FIXTURES;
  if (!fixturePath) {
    throw new Error('BATEYE_OCTOKIT_FIXTURES is required for the Octokit mock hook');
  }

  return {
    fixturePath,
    state: JSON.parse(fs.readFileSync(fixturePath, 'utf-8')),
  };
}

function writeFixtures(fixturePath, state) {
  fs.writeFileSync(fixturePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

function appendAction(state, action) {
  if (!Array.isArray(state.actions)) {
    state.actions = [];
  }
  state.actions.push(action);
}

function nextCommentId(state) {
  const issueIds = (state.issueComments || []).map(comment => comment.id || 0);
  const reviewIds = (state.reviewComments || []).map(comment => comment.id || 0);
  return Math.max(0, ...issueIds, ...reviewIds) + 1;
}

class MockOctokit {
  constructor() {
    // Simulate octokit.paginate: calls the endpoint fn once and returns data array.
    // The mock fixture is small enough that a single page always covers all items.
    this.paginate = async (fn, params) => {
      const result = await fn(params);
      return result.data;
    };

    this.rest = {
      pulls: {
        get: async params => {
          const { state } = readFixtures();
          const pr = state.pullRequest || {};
          return {
            data: {
              base: {
                ref: pr.baseRef || 'main',
                sha: pr.baseSha || 'base-sha',
              },
              head: {
                ref: pr.headRef || 'feature',
                sha: pr.headSha || 'head-sha',
              },
            },
          };
        },
        createReviewComment: async params => {
          const { fixturePath, state } = readFixtures();
          const shouldFail = Array.isArray(state.failCreateReviewComment)
            ? state.failCreateReviewComment.some(entry => entry.path === params.path && entry.line === params.line)
            : Boolean(state.failCreateReviewComment);
          if (shouldFail) {
            const error = new Error('Validation Failed: {"resource":"PullRequestReviewComment","code":"custom","field":"pull_request_review_thread.line","message":"could not be resolved"}');
            throw error;
          }
          appendAction(state, { type: 'createReviewComment', params });
          writeFixtures(fixturePath, state);
          return { data: { id: nextCommentId(state) } };
        },
        listReviewComments: async () => {
          const { state } = readFixtures();
          return { data: state.reviewComments || [] };
        },
        createReview: async params => {
          const { fixturePath, state } = readFixtures();
          appendAction(state, { type: 'createReview', params });
          writeFixtures(fixturePath, state);
          return { data: { id: nextCommentId(state) } };
        },
      },
      issues: {
        createComment: async params => {
          const { fixturePath, state } = readFixtures();
          const comment = {
            id: nextCommentId(state),
            body: params.body,
            user: { login: 'bateye-bot' },
            created_at: '2026-03-16T00:00:00Z',
          };
          if (!Array.isArray(state.issueComments)) {
            state.issueComments = [];
          }
          state.issueComments.push(comment);
          appendAction(state, { type: 'createComment', params });
          writeFixtures(fixturePath, state);
          return { data: comment };
        },
        updateComment: async params => {
          const { fixturePath, state } = readFixtures();
          const existing = (state.issueComments || []).find(comment => comment.id === params.comment_id);
          if (existing) {
            existing.body = params.body;
          }
          appendAction(state, { type: 'updateComment', params });
          writeFixtures(fixturePath, state);
          return { data: existing || { id: params.comment_id, body: params.body } };
        },
        listComments: async () => {
          const { state } = readFixtures();
          return { data: state.issueComments || [] };
        },
      },
      reactions: {
        createForIssueComment: async params => {
          const { fixturePath, state } = readFixtures();
          appendAction(state, { type: 'createReaction', params });
          writeFixtures(fixturePath, state);
          return { data: { id: nextCommentId(state) } };
        },
      },
    };
  }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'octokit') {
    return { Octokit: MockOctokit };
  }
  return originalLoad(request, parent, isMain);
};
