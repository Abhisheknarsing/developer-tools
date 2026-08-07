// DeveloperTool Options Page Controller
document.addEventListener('DOMContentLoaded', async () => {
  const jiraUrlInput = document.getElementById('jiraUrl');
  const userEmailInput = document.getElementById('userEmail');
  const myTicketsOnlyCheckbox = document.getElementById('myTicketsOnly');
  const githubReposTextarea = document.getElementById('githubRepos');
  const githubTokenInput = document.getElementById('githubToken');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // Load Saved Storage
  const config = await chrome.storage.local.get([
    'defaultJiraUrl',
    'userEmail',
    'myTicketsOnly',
    'githubRepos',
    'githubToken'
  ]);

  if (config.defaultJiraUrl) jiraUrlInput.value = config.defaultJiraUrl;
  if (config.userEmail) userEmailInput.value = config.userEmail;
  if (typeof config.myTicketsOnly === 'boolean') myTicketsOnlyCheckbox.checked = config.myTicketsOnly;
  if (config.githubRepos && Array.isArray(config.githubRepos)) {
    githubReposTextarea.value = config.githubRepos.join('\n');
  } else if (typeof config.githubRepos === 'string') {
    githubReposTextarea.value = config.githubRepos;
  }
  if (config.githubToken) githubTokenInput.value = config.githubToken;

  // Save Settings Event Handler
  saveBtn.addEventListener('click', async () => {
    const defaultJiraUrl = jiraUrlInput.value.trim();
    const userEmail = userEmailInput.value.trim();
    const myTicketsOnly = myTicketsOnlyCheckbox.checked;

    // Parse multi-line GitHub Repos textarea
    const rawRepos = githubReposTextarea.value.split('\n');
    const githubRepos = rawRepos
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const githubToken = githubTokenInput.value.trim();

    await chrome.storage.local.set({
      defaultJiraUrl,
      userEmail,
      myTicketsOnly,
      githubRepos,
      githubToken
    });

    // Show toast feedback
    saveStatus.classList.remove('hidden');
    setTimeout(() => {
      saveStatus.classList.add('hidden');
    }, 2500);
  });
});
