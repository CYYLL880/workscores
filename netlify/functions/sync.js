/**
 * Netlify Serverless Function: /api/sync
 * 代理 GitHub API 调用，Token 在后端环境变量中，前端永远看不到
 *
 * 环境变量（在 Netlify Dashboard 配置）：
 * - GH_TOKEN: GitHub Personal Access Token
 * - GH_OWNER: GitHub 用户名 (CYYLL880)
 * - GH_REPO: 仓库名 (workscores)
 * - GH_FILE: 文件路径 (work_scores_custom.json)
 *
 * API：
 * - GET  /api/sync  下载数据（无需鉴权）
 * - POST /api/sync  上传数据（需鉴权，密码 DZZGF20260630）
 */

const AUTH_PASSWORD = 'DZZGF20260630';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Password',
  'Content-Type': 'application/json',
};

exports.handler = async (event, context) => {
  // 处理 CORS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      return await handleGet(event, context);
    }
    if (event.httpMethod === 'POST') {
      return await handlePost(event, context);
    }
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: 'Method not allowed' }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: e.message }),
    };
  }
};

/**
 * 下载数据：从 GitHub API 获取
 */
async function handleGet(event, context) {
  const url = `https://api.github.com/repos/${process.env.GH_OWNER}/${process.env.GH_REPO}/contents/${process.env.GH_FILE}`;
  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'netlify-function',
    },
  });

  if (resp.status === 200) {
    try {
      const data = await resp.json();
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const parsed = JSON.parse(content);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          status: 'ok',
          categories: parsed.categories || null,
        }),
      };
    } catch (e) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ status: 'error', message: '解析失败' }),
      };
    }
  } else if (resp.status === 404) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'empty', categories: null }),
    };
  } else {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({
        status: 'error',
        message: 'GitHub API 错误: ' + resp.status,
      }),
    };
  }
}

/**
 * 上传数据：验证密码后，通过 GitHub API 更新文件
 */
async function handlePost(event, context) {
  // 1. 验证密码
  const password = event.headers['x-auth-password'];
  if (password !== AUTH_PASSWORD) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: '未授权' }),
    };
  }

  // 2. 解析请求体
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: '无效的 JSON' }),
    };
  }

  const categories = body.categories;
  if (!categories) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: '缺少 categories 字段' }),
    };
  }

  const content = JSON.stringify({ categories: categories });

  // 3. 获取当前文件的 sha（GitHub 更新文件需要）
  let sha = null;
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${process.env.GH_OWNER}/${process.env.GH_REPO}/contents/${process.env.GH_FILE}`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'netlify-function',
          'Authorization': `token ${process.env.GH_TOKEN}`,
        },
      }
    );
    if (resp.status === 200) {
      const data = await resp.json();
      sha = data.sha;
    }
  } catch (e) {
    // 文件不存在（首次创建），sha 保持 null
  }

  // 4. 上传到 GitHub
  const uploadBody = {
    message: 'Update work scores data via Netlify',
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) uploadBody.sha = sha;

  const uploadResp = await fetch(
    `https://api.github.com/repos/${process.env.GH_OWNER}/${process.env.GH_REPO}/contents/${process.env.GH_FILE}`,
    {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'netlify-function',
        'Authorization': `token ${process.env.GH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(uploadBody),
    }
  );

  if (uploadResp.status === 200 || uploadResp.status === 201) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'ok', message: '上传成功' }),
    };
  } else {
    const errData = await uploadResp.json().catch(() => ({}));
    return {
      statusCode: uploadResp.status,
      headers: corsHeaders,
      body: JSON.stringify({
        status: 'error',
        message: errData.message || '上传失败',
      }),
    };
  }
}
