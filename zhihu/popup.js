document.addEventListener('DOMContentLoaded', function() {
  // 获取开关状态和关键词
  chrome.storage.sync.get({
    blockingEnabled: true,  // 默认启用
    authorKeywords: '',
    questionKeywords: '',
    answerKeywords: '',
    commentKeywords: ''
  }, function(items) {
    document.getElementById('blockingSwitch').checked = items.blockingEnabled;
    document.getElementById('authorKeywords').value = items.authorKeywords;
    document.getElementById('questionKeywords').value = items.questionKeywords;
    document.getElementById('answerKeywords').value = items.answerKeywords;
    document.getElementById('commentKeywords').value = items.commentKeywords;
  });

  // 监听开关变化
  document.getElementById('blockingSwitch').addEventListener('change', function(e) {
    const enabled = e.target.checked;
    chrome.storage.sync.set({ blockingEnabled: enabled }, function() {
      // 图标会通过 storage.onChanged 监听器自动更新
      // 通知 content script 更新过滤状态
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "updateBlockingState",
          enabled: enabled
        });
      });
    });
  });

  // 监听关键词变化
  ['author', 'question', 'answer', 'comment'].forEach(type => {
    document.getElementById(type + 'Keywords').addEventListener('input', function(e) {
      const data = {};
      data[type + 'Keywords'] = e.target.value;
      chrome.storage.sync.set(data, function() {
        // 通知 content script 更新过滤
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "updateFilter" });
        });
      });
    });
  });

  // 导出配置
  document.getElementById('exportBtn').addEventListener('click', function() {
    chrome.storage.sync.get({
      authorKeywords: '',
      questionKeywords: '',
      answerKeywords: '',
      commentKeywords: ''
    }, function(config) {
      const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zhihu-block-config.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      const status = document.getElementById('status');
      status.textContent = '配置已导出';
      setTimeout(() => status.textContent = '', 2000);
    });
  });

  // 导入配置
  document.getElementById('importBtn').addEventListener('click', function() {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const config = JSON.parse(e.target.result);
        // 只导入关键词配置
        const keywordsConfig = {
          authorKeywords: config.authorKeywords || '',
          questionKeywords: config.questionKeywords || '',
          answerKeywords: config.answerKeywords || '',
          commentKeywords: config.commentKeywords || ''
        };
        
        chrome.storage.sync.set(keywordsConfig, function() {
          // 更新界面
          document.getElementById('authorKeywords').value = keywordsConfig.authorKeywords;
          document.getElementById('questionKeywords').value = keywordsConfig.questionKeywords;
          document.getElementById('answerKeywords').value = keywordsConfig.answerKeywords;
          document.getElementById('commentKeywords').value = keywordsConfig.commentKeywords;

          // 通知内容脚本更新过滤
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "updateFilter" });
          });

          const status = document.getElementById('status');
          status.textContent = '配置已导入';
          setTimeout(() => status.textContent = '', 2000);
        });
      } catch (err) {
        const status = document.getElementById('status');
        status.textContent = '导入失败：无效的配置文件';
        status.style.color = 'red';
        setTimeout(() => {
          status.textContent = '';
          status.style.color = 'green';
        }, 2000);
      }
    };
    reader.readAsText(file);
  });
}); 