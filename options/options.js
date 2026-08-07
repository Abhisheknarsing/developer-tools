// DeveloperTool Options Page Controller (Auto-Save on Change)
document.addEventListener('DOMContentLoaded', async () => {
  const jiraUrlInput = document.getElementById('jiraUrl');
  const userEmailInput = document.getElementById('userEmail');
  const myTicketsOnlyCheckbox = document.getElementById('myTicketsOnly');
  const githubHostInput = document.getElementById('githubHost');
  const githubReposTextarea = document.getElementById('githubRepos');
  const githubTokenInput = document.getElementById('githubToken');
  const saveStatus = document.getElementById('saveStatus');

  // Load Saved Storage
  const config = await chrome.storage.local.get([
    'defaultJiraUrl',
    'userEmail',
    'myTicketsOnly',
    'githubHost',
    'githubRepos',
    'githubToken'
  ]);

  if (config.defaultJiraUrl) jiraUrlInput.value = config.defaultJiraUrl;
  if (config.userEmail) userEmailInput.value = config.userEmail;
  if (typeof config.myTicketsOnly === 'boolean') myTicketsOnlyCheckbox.checked = config.myTicketsOnly;
  if (config.githubHost) githubHostInput.value = config.githubHost;
  if (config.githubRepos && Array.isArray(config.githubRepos)) {
    githubReposTextarea.value = config.githubRepos.join('\n');
  } else if (typeof config.githubRepos === 'string') {
    githubReposTextarea.value = config.githubRepos;
  }
  if (config.githubToken) githubTokenInput.value = config.githubToken;

  let debounceTimer = null;

  async function performAutoSave() {
    const defaultJiraUrl = jiraUrlInput.value.trim();
    const userEmail = userEmailInput.value.trim();
    const myTicketsOnly = myTicketsOnlyCheckbox.checked;
    const githubHost = githubHostInput.value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

    const rawRepos = githubReposTextarea.value.split('\n');
    const githubRepos = rawRepos
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const githubToken = githubTokenInput.value.trim();

    await chrome.storage.local.set({
      defaultJiraUrl,
      userEmail,
      myTicketsOnly,
      githubHost,
      githubRepos,
      githubToken
    });

    if (saveStatus) {
      saveStatus.classList.add('saved');
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        saveStatus.classList.remove('saved');
      }, 1500);
    }
  }

  // Auto-Save Event Listeners for All Form Controls
  [jiraUrlInput, userEmailInput, githubHostInput, githubTokenInput].forEach((input) => {
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(performAutoSave, 400);
    });
  });

  githubReposTextarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performAutoSave, 500);
  });

  myTicketsOnlyCheckbox.addEventListener('change', performAutoSave);
});
