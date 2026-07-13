type InitOptions = {
  inputId: string;
  buttonId: string;
  statusId: string;
  resultsId: string;
  configId: string;
  chatThreadId: string;
  chatInputId: string;
  chatButtonId: string;
};

type ResultRecord = {
  source: string;
  kind: string;
  score: number;
  title: string;
  subtitle?: string;
  snippet?: string;
  link?: string;
  provenance?: string;
};

type ApiResponse = {
  query: string;
  count: number;
  elapsed_ms: number;
  warnings?: string[];
  results: ResultRecord[];
};

type ChatResponse = {
  reply: string;
  warnings?: string[];
  model?: string;
  session_id?: string | null;
};

type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function initFederatedSearch(options: InitOptions) {
  const input = document.getElementById(options.inputId) as HTMLInputElement | null;
  const button = document.getElementById(options.buttonId) as HTMLButtonElement | null;
  const status = document.getElementById(options.statusId);
  const results = document.getElementById(options.resultsId);
  const config = document.getElementById(options.configId);
  const chatThread = document.getElementById(options.chatThreadId);
  const chatInput = document.getElementById(options.chatInputId) as HTMLTextAreaElement | null;
  const chatButton = document.getElementById(options.chatButtonId) as HTMLButtonElement | null;

  if (!input || !button || !status || !results || !config || !chatThread || !chatInput || !chatButton) {
    return;
  }

  const configData = JSON.parse(config.textContent || '{}') as { apiBase?: string };
  const apiBase = (configData.apiBase || '').trim();

  if (!apiBase) {
    status.textContent = 'Search API is not configured on this deployment yet.';
    button.disabled = true;
    chatButton.disabled = true;
    return;
  }

  const appendChat = (role: 'user' | 'assistant', content: string) => {
    const article = document.createElement('article');
    article.className = `chat-bubble chat-${role}`;
    article.textContent = content;
    chatThread.appendChild(article);
    chatThread.scrollTop = chatThread.scrollHeight;
  };

  const chatHistory: ChatTurn[] = [];
  let sessionId: string | null = null;

  const renderResults = (payload: ApiResponse) => {
    if (payload.results.length === 0) {
      results.innerHTML = '<p class="empty-state">No matches found.</p>';
      return;
    }

    const rows = payload.results
      .map((item) => {
        const title = escapeHtml(item.title || 'Untitled');
        const subtitle = item.subtitle ? `<div class="row-meta">${escapeHtml(item.subtitle)}</div>` : '';
        const snippet = item.snippet ? `<div class="row-meta">${escapeHtml(item.snippet)}</div>` : '';
        const provenance = item.provenance ? `<span class="row-code">${escapeHtml(item.provenance)}</span>` : '';
        const badges = `<div class="detail-links"><span class="badge">${escapeHtml(item.source)}</span><span class="badge">${escapeHtml(item.kind)}</span><span class="badge">score ${item.score.toFixed(3)}</span>${provenance}</div>`;
        const body = `<div class="row-head"><h4 class="row-title">${title}</h4></div>${subtitle}${snippet}${badges}`;

        if (item.link) {
          return `<a class="table-row row-clickable" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${body}</a>`;
        }
        return `<article class="table-row">${body}</article>`;
      })
      .join('');

    results.innerHTML = rows;
  };

  const run = async () => {
    const query = input.value.trim();
    if (!query) {
      status.textContent = 'Enter a query to search.';
      results.innerHTML = '';
      return;
    }

    button.disabled = true;
    status.textContent = `Searching for "${query}"...`;

    try {
      const url = new URL('/v1/search', apiBase);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '40');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed (${response.status})`);
      }

      const payload = (await response.json()) as ApiResponse;
      renderResults(payload);

      const warningSuffix = payload.warnings && payload.warnings.length > 0
        ? ` (${payload.warnings.length} source warning${payload.warnings.length === 1 ? '' : 's'})`
        : '';
      status.textContent = `${payload.count} results in ${payload.elapsed_ms} ms${warningSuffix}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      status.textContent = `Search failed: ${message}`;
      results.innerHTML = '<p class="empty-state">Unable to reach the search API. Verify PUBLIC_FEDERATED_SEARCH_API_URL and backend CORS settings.</p>';
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', run);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });

  const runChat = async () => {
    const message = chatInput.value.trim();
    if (!message) {
      return;
    }

    appendChat('user', message);
    chatHistory.push({ role: 'user', content: message });
    if (chatHistory.length > 24) {
      chatHistory.splice(0, chatHistory.length - 24);
    }
    chatInput.value = '';
    chatButton.disabled = true;

    try {
      const url = new URL('/v1/chat', apiBase);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          message,
          limit: 50,
          session_id: sessionId,
          history: chatHistory,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`);
      }

      const payload = (await response.json()) as ChatResponse;
      if (payload.session_id) {
        sessionId = payload.session_id;
      }
      const modelSuffix = payload.model ? `\n\nModel: ${payload.model}` : '';
      const warningSuffix = payload.warnings && payload.warnings.length > 0
        ? `\n\nWarnings: ${payload.warnings.join(' | ')}`
        : '';
      const reply = payload.reply || 'No response.';
      appendChat('assistant', `${reply}${modelSuffix}${warningSuffix}`);
      chatHistory.push({ role: 'assistant', content: reply });
      if (chatHistory.length > 24) {
        chatHistory.splice(0, chatHistory.length - 24);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      appendChat('assistant', `Chat failed: ${messageText}`);
    } finally {
      chatButton.disabled = false;
    }
  };

  chatButton.addEventListener('click', runChat);
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      runChat();
    }
  });
}
