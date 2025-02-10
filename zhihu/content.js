// 添加错误处理的包装函数
function handleChromeError(callback) {
  try {
    return callback();
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('Extension reloaded, please refresh the page');
      // 可以选择自动刷新页面
      // window.location.reload();
    } else {
      throw error;
    }
  }
}

function checkKeywords(text, keywords) {
  if (!keywords) return false;
  const keywordList = keywords.split('\n').map(k => k.trim()).filter(k => k);
  return keywordList.some(keyword => text.includes(keyword));
}

function filterContent() {
  handleChromeError(() => {
    chrome.storage.sync.get({
      authorKeywords: '',
      questionKeywords: '',
      answerKeywords: ''
    }, function(items) {
      const feeds = document.querySelectorAll('.Feed');
      
      feeds.forEach(feed => {
        const author = feed.querySelector('.AuthorInfo-name')?.textContent || '';
        const question = feed.querySelector('.ContentItem-title')?.textContent || '';
        const answer = feed.querySelector('.RichText')?.textContent || '';

        if (checkKeywords(author, items.authorKeywords) ||
            checkKeywords(question, items.questionKeywords) ||
            checkKeywords(answer, items.answerKeywords)) {
          feed.style.display = 'none';
        }
      });
    });
  });
}

// 初始过滤
filterContent();

// 创建观察器监听动态加载的内容
const observer = new MutationObserver(() => handleChromeError(filterContent));
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// 监听来自background script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleChromeError(() => {
    if (request.action === "addTitle") {
      // 处理添加标题
      chrome.storage.sync.get({ questionKeywords: '' }, function(items) {
        const newKeywords = items.questionKeywords + (items.questionKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ questionKeywords: newKeywords }, function() {
          console.log('Title keyword added:', request.text);
          filterContent(); // 重新过滤内容
        });
      });
    } else if (request.action === "addContent") {
      // 处理添加内容
      chrome.storage.sync.get({ answerKeywords: '' }, function(items) {
        const newKeywords = items.answerKeywords + (items.answerKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ answerKeywords: newKeywords }, function() {
          console.log('Content keyword added:', request.text);
          filterContent(); // 重新过滤内容
        });
      });
    }
  });
});

// 添加判断选中区域类型的函数
function getSelectionType() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  
  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer;
  
  // 获取选中文本所在的元素
  const node = element.nodeType === 3 ? element.parentNode : element;
  
  // 判断是否为标题元素
  const isHeading = /^H[1-6]$/i.test(node.tagName) || 
                    window.getComputedStyle(node).fontWeight >= 600;
  
  return isHeading ? 'title' : 'content';
}

// 监听选中文本事件
document.addEventListener('mouseup', () => {
  handleChromeError(() => {
    const selection = window.getSelection().toString().trim();
    if (!selection) return;
    
    const type = getSelectionType();
    // 更新选中区域类型
    chrome.runtime.sendMessage({
      action: "updateContextMenu",
      type: type
    });
  });
}); 