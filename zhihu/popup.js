// 添加立即执行的调试日志
console.log('popup.js 开始加载');

// 确保在 DOM 加载完成后执行
if (document.readyState === 'loading') {
  console.log('DOM 正在加载，等待 DOMContentLoaded 事件');
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  console.log('DOM 已加载完成，直接初始化');
  initializePopup();
}

function initializePopup() {
  console.log('开始初始化 popup');

  // 更新单个类型的关键词计数
  function updateKeywordCount(type) {
    console.log(`开始更新 ${type} 关键词计数`);
    const textarea = document.getElementById(type + 'Keywords');
    if (!textarea) {
      console.error(`找不到 ${type}Keywords textarea 元素`);
      return 0;
    }
    
    const value = textarea.value || '';
    console.log(`${type} 关键词内容:`, value);
    
    const keywords = value.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);  // 过滤空行
    
    console.log(`${type} 关键词列表:`, keywords);
    const count = keywords.length;
    console.log(`${type} 关键词数量:`, count);
    
    const countElement = document.getElementById(type + 'Count');
    if (!countElement) {
      console.error(`找不到 ${type}Count 元素`);
      return count;
    }
    
    countElement.textContent = `${count} 个关键词`;
    return count;
  }

  // 更新所有类型的关键词计数
  function updateAllKeywordCounts() {
    console.log('开始更新所有关键词计数');
    const types = ['author', 'question', 'answer', 'comment'];
    types.forEach(type => {
      updateKeywordCount(type);
    });
    console.log('完成更新所有关键词计数');
  }

  // 从 storage 获取并更新关键词
  function loadAndUpdateKeywords() {
    console.log('开始从 storage 加载关键词');
    chrome.storage.sync.get({
      blockingEnabled: true,
      authorKeywords: '',
      questionKeywords: '',
      answerKeywords: '',
      commentKeywords: ''
    }, function(items) {
      console.log('从 storage 获取到的关键词:', items);
      
      if (chrome.runtime.lastError) {
        console.error('获取 storage 数据时出错:', chrome.runtime.lastError);
        return;
      }

      // 更新界面显示
      const blockingSwitch = document.getElementById('blockingSwitch');
      if (blockingSwitch) {
        blockingSwitch.checked = items.blockingEnabled;
      }

      const textareas = {
        authorKeywords: document.getElementById('authorKeywords'),
        questionKeywords: document.getElementById('questionKeywords'),
        answerKeywords: document.getElementById('answerKeywords'),
        commentKeywords: document.getElementById('commentKeywords')
      };

      // 更新每个文本框的值
      Object.entries(textareas).forEach(([key, textarea]) => {
        if (textarea) {
          textarea.value = items[key] || '';
          console.log(`设置 ${key} 的值:`, items[key] || '');
        } else {
          console.error(`找不到 ${key} 文本框元素`);
        }
      });

      // 更新关键词计数
      updateAllKeywordCounts();
    });
  }

  // 监听关键词变化
  ['author', 'question', 'answer', 'comment'].forEach(type => {
    const textarea = document.getElementById(type + 'Keywords');
    if (!textarea) {
      console.error(`找不到 ${type}Keywords textarea 元素`);
      return;
    }

    // 监听输入变化
    textarea.addEventListener('input', function(e) {
      console.log(`${type} 关键词输入变化:`, e.target.value);
      
      // 立即更新关键词计数
      updateKeywordCount(type);

      // 保存到 storage
      const data = {};
      data[type + 'Keywords'] = e.target.value;
      data.blockingEnabled = document.getElementById('blockingSwitch').checked;
      
      console.log(`保存 ${type} 关键词到 storage:`, data);
      chrome.storage.sync.set(data, function() {
        if (chrome.runtime.lastError) {
          console.error('保存到 storage 时出错:', chrome.runtime.lastError);
          return;
        }
        console.log(`${type} 关键词保存成功`);
        
        // 通知内容脚本更新过滤
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { 
              action: "updateFilter",
              enabled: document.getElementById('blockingSwitch').checked
            });
          }
        });
      });
    });
  });

  // 监听 storage 变化
  chrome.storage.onChanged.addListener(function(changes, namespace) {
    console.log('Storage 变化:', changes, namespace);
    if (namespace === 'sync') {
      const types = ['author', 'question', 'answer', 'comment'];
      types.forEach(type => {
        const key = type + 'Keywords';
        if (changes[key]) {
          console.log(`${key} 发生变化:`, changes[key]);
          const textarea = document.getElementById(key);
          if (textarea) {
            textarea.value = changes[key].newValue;
            updateKeywordCount(type);
          }
        }
      });
    }
  });

  // 初始化时加载关键词并更新计数
  console.log('开始初始化加载关键词');
  loadAndUpdateKeywords();

  // 监听开关变化
  document.getElementById('blockingSwitch').addEventListener('change', function(e) {
    const enabled = e.target.checked;
    // 先更新存储
    chrome.storage.sync.set({
      blockingEnabled: enabled
    }, function() {
      // 获取当前标签页并发送消息
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          // 立即发送消息到当前标签页
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateBlockingState",
            enabled: enabled
          }, function(response) {
            if (chrome.runtime.lastError) {
              console.error('发送消息失败:', chrome.runtime.lastError);
              return;
            }
            // 显示保存成功消息
            const status = document.getElementById('status');
            status.textContent = enabled ? '已启用屏蔽' : '已禁用屏蔽';
            setTimeout(function() {
              status.textContent = '';
            }, 750);
          });
        }
      });
    });
  });

  // 更新统计显示
  function updateStatsDisplay(stats) {
    document.getElementById('todayBlocked').textContent = `${stats.today} 条`;
    document.getElementById('totalBlocked').textContent = `${stats.total} 条`;
    document.getElementById('authorBlocked').textContent = `${stats.byType.author} 条`;
    document.getElementById('titleBlocked').textContent = `${stats.byType.title} 条`;
    document.getElementById('contentBlocked').textContent = `${stats.byType.content} 条`;
    document.getElementById('commentBlocked').textContent = `${stats.byType.comment} 条`;
  }

  // 监听来自 content script 的统计更新
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateStats") {
      updateStatsDisplay(request.stats);
    }
  });

  // 初始化时加载统计信息
  chrome.storage.local.get('stats', function(data) {
    if (data.stats) {
      updateStatsDisplay(data.stats);
    }
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
          commentKeywords: config.commentKeywords || '',
          minUpvotes: config.minUpvotes || 10
        };
        
        chrome.storage.sync.set(keywordsConfig, function() {
          // 更新界面
          document.getElementById('authorKeywords').value = keywordsConfig.authorKeywords;
          document.getElementById('questionKeywords').value = keywordsConfig.questionKeywords;
          document.getElementById('answerKeywords').value = keywordsConfig.answerKeywords;
          document.getElementById('commentKeywords').value = keywordsConfig.commentKeywords;
          document.getElementById('minUpvotes').value = keywordsConfig.minUpvotes;

          // 更新关键词计数
          updateAllKeywordCounts();

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
} 