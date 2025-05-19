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
  if (!text || !keywords) {
    return false;
  }
  
  const keywordArray = keywords.split('\n').map(keyword => keyword.trim().toLowerCase());
  const lowerCaseText = text.trim().toLowerCase();
  
  return keywordArray.some(keyword => lowerCaseText.includes(keyword));
}

// 添加防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 使用防抖包装 filterContent
const debouncedFilterContent = debounce(filterContent, 300);

// 添加已处理内容的记录
const processedItems = new Set();

// 添加全局变量来跟踪屏蔽状态
let isBlockingEnabled = true;

// 添加统计相关的函数和变量
let stats = {
  total: 0,
  today: 0,
  byType: {
    author: 0,
    title: 0,
    content: 0,
    comment: 0
  },
  lastResetDate: new Date().toDateString()
};

// 更新统计信息
function updateStats(type) {
  // 检查是否需要重置今日统计
  const today = new Date().toDateString();
  if (today !== stats.lastResetDate) {
    stats.today = 0;
    stats.lastResetDate = today;
  }

  // 更新统计
  stats.total++;
  stats.today++;
  stats.byType[type]++;

  // 保存统计信息
  chrome.storage.local.set({ stats: stats }, function() {
    // 通知 popup 更新统计显示
    chrome.runtime.sendMessage({
      action: "updateStats",
      stats: stats
    });
  });
}

function filterContent(authorKeywords, questionKeywords, answerKeywords, commentKeywords, minUpvotes) {
  // 如果屏蔽被禁用，显示所有内容并返回
  if (!isBlockingEnabled) {
    const feedItems = document.querySelectorAll('.Feed, .HotItem, .List-item');
    feedItems.forEach(item => {
      const cardContainer = item.closest('.Card');
      if (cardContainer) {
        cardContainer.style.display = '';
        processedItems.delete(cardContainer);
      }
      item.style.display = '';
      processedItems.delete(item);
    });
    return;
  }

  // 从 storage 获取最新的关键词
  chrome.storage.sync.get({
    authorKeywords: '',
    questionKeywords: '',
    answerKeywords: '',
    commentKeywords: '',
    minUpvotes: 0,
    blockingEnabled: true  // 添加 blockingEnabled 到获取项中
  }, function(items) {
    // 更新全局屏蔽状态
    isBlockingEnabled = items.blockingEnabled;
    
    // 如果屏蔽被禁用，显示所有内容并返回
    if (!isBlockingEnabled) {
      const feedItems = document.querySelectorAll('.Feed, .HotItem, .List-item');
      feedItems.forEach(item => {
        const cardContainer = item.closest('.Card');
        if (cardContainer) {
          cardContainer.style.display = '';
          processedItems.delete(cardContainer);
        }
        item.style.display = '';
        processedItems.delete(item);
      });
      return;
    }

    const authorKeywordsArray = items.authorKeywords ? items.authorKeywords.split('\n').map(k => k.trim().toLowerCase()) : [];
    const questionKeywordsArray = items.questionKeywords ? items.questionKeywords.split('\n').map(k => k.trim().toLowerCase()) : [];
    const answerKeywordsArray = items.answerKeywords ? items.answerKeywords.split('\n').map(k => k.trim().toLowerCase()) : [];
    const commentKeywordsArray = items.commentKeywords ? items.commentKeywords.split('\n').map(k => k.trim().toLowerCase()) : [];

    // 获取所有需要过滤的内容项
    const feedItems = document.querySelectorAll('.Feed, .HotItem, .List-item');

    feedItems.forEach(item => {
      // 检查是否已经处理过这个元素
      if (processedItems.has(item)) {
        return;
      }

      let shouldRemove = false;

      // 检查是否为热榜项目
      const isHotItem = item.classList.contains('HotItem');

      // 获取标题和内容文本
      let titleElement, contentElement;
      if (isHotItem) {
        titleElement = item.querySelector('.HotItem-title');
        contentElement = item.querySelector('.HotItem-excerpt');
      } else {
        titleElement = item.querySelector('.ContentItem-title, .QuestionItem-title');
        contentElement = item.querySelector('.RichText.ztext');
      }

      let titleText = titleElement ? titleElement.textContent.trim().toLowerCase() : '';
      let contentText = contentElement ? contentElement.textContent.trim().toLowerCase() : '';

      // 获取作者名
      let authorElement = item.querySelector('.AuthorInfo-name, .UserLink-link');
      let authorName = authorElement ? authorElement.textContent.trim().toLowerCase() : '';

      // 关键词过滤
      let blockReason = '';
      let triggeredKeyword = '';
      
      if (authorKeywordsArray.some(keyword => authorName.includes(keyword))) {
        shouldRemove = true;
        triggeredKeyword = authorKeywordsArray.find(keyword => authorName.includes(keyword));
        blockReason = `作者名 "${authorName}" 触发了屏蔽关键词 "${triggeredKeyword}"`;
        updateStats('author');
      } else if (questionKeywordsArray.some(keyword => titleText.includes(keyword))) {
        shouldRemove = true;
        triggeredKeyword = questionKeywordsArray.find(keyword => titleText.includes(keyword));
        blockReason = `标题触发了屏蔽关键词 "${triggeredKeyword}"`;
        updateStats('title');
      } else if (answerKeywordsArray.some(keyword => contentText.includes(keyword))) {
        shouldRemove = true;
        triggeredKeyword = answerKeywordsArray.find(keyword => contentText.includes(keyword));
        blockReason = `内容触发了屏蔽关键词 "${triggeredKeyword}"`;
        updateStats('content');
      } else if (commentKeywordsArray.some(keyword => contentText.includes(keyword))) {
        shouldRemove = true;
        triggeredKeyword = commentKeywordsArray.find(keyword => contentText.includes(keyword));
        blockReason = `评论触发了屏蔽关键词 "${triggeredKeyword}"`;
        updateStats('comment');
      }

      // 移除元素
      if (shouldRemove) {
        // 查找并隐藏外层的 Card 容器
        const cardContainer = item.closest('.Card');
        if (cardContainer) {
          cardContainer.style.display = 'none';
          processedItems.add(cardContainer);
        }
        item.style.display = 'none';
        processedItems.add(item);
        console.log(`[知乎屏蔽] ${blockReason} ${'-'.repeat(20)} 标题: "${titleText}"`);
      } else {
        // 确保之前被隐藏的元素能够重新显示
        const cardContainer = item.closest('.Card');
        if (cardContainer) {
          cardContainer.style.display = '';
          processedItems.delete(cardContainer);
        }
        item.style.display = '';
        processedItems.delete(item);
      }
    });

    // 定期清理已处理记录，避免内存泄漏
    if (processedItems.size > 1000) {
      processedItems.clear();
    }
  });
}

// 初始过滤
debouncedFilterContent();

// 修改观察器使用防抖版本
const observer = new MutationObserver(() => handleChromeError(debouncedFilterContent));
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// 修改消息处理部分
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleChromeError(() => {
    // 处理所有可能包含 enabled 状态的消息
    if (request.enabled !== undefined) {
      isBlockingEnabled = request.enabled;
    }

    if (request.action === "updateBlockingState") {
      // 立即执行过滤
      filterContent();
      // 发送响应
      sendResponse({ success: true });
    } else if (request.action === "updateFilter") {
      // 使用防抖版本进行过滤
      debouncedFilterContent();
      // 发送响应
      sendResponse({ success: true });
    } else if (request.action === "addTitle") {
      // 处理添加标题
      chrome.storage.sync.get({ questionKeywords: '' }, function(items) {
        const newKeywords = items.questionKeywords + (items.questionKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ questionKeywords: newKeywords }, function() {
          console.log('Title keyword added:', request.text);
          debouncedFilterContent();
        });
      });
    } else if (request.action === "addContent") {
      // 处理添加内容
      chrome.storage.sync.get({ answerKeywords: '' }, function(items) {
        const newKeywords = items.answerKeywords + (items.answerKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ answerKeywords: newKeywords }, function() {
          console.log('Content keyword added:', request.text);
          debouncedFilterContent();
        });
      });
    } else if (request.action === "addAuthor") {
      // 处理添加作者
      chrome.storage.sync.get({ authorKeywords: '' }, function(items) {
        const newKeywords = items.authorKeywords + (items.authorKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ authorKeywords: newKeywords }, function() {
          console.log('Author keyword added:', request.text);
          debouncedFilterContent();
        });
      });
    } else if (request.action === "addComment") {
      chrome.storage.sync.get({ commentKeywords: '' }, function(items) {
        const newKeywords = items.commentKeywords + (items.commentKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ commentKeywords: newKeywords }, function() {
          console.log('Comment keyword added:', request.text);
          debouncedFilterContent();
        });
      });
    }
  });
});

// 修改判断选中区域类型的函数
function getSelectionType() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer;

  // 获取选中文本所在的元素
  const node = element.nodeType === 3 ? element.parentNode : element;

  // 检查是否为作者名区域
  const isAuthorArea = (node) => {
    // 检查是否为作者链接或其父元素
    const isAuthorLink = node.matches?.('.UserLink-link, .AuthorInfo a[href*="/people/"]') || 
                        node.closest?.('.UserLink-link, .AuthorInfo a[href*="/people/"]');
    
    // 检查是否为作者名容器
    const isAuthorContainer = node.matches?.('.AuthorInfo-name, .AuthorInfo') || 
                            node.closest?.('.AuthorInfo-name, .AuthorInfo');

    // 如果是作者区域，获取整个内容容器
    if (isAuthorLink || isAuthorContainer) {
      // 查找最近的内容容器
      const contentContainer = node.closest('.ContentItem, .Feed, .TopstoryItem, .Card');
      if (contentContainer) {
        // 保存内容容器的引用，以便后续使用
        window.currentContentContainer = contentContainer;
        return true;
      }
    }

    return false;
  };

  // 首先检查作者区域
  if (isAuthorArea(node)) {
    return 'author';
  }

  // 检查是否为评论区域
  if (node.classList?.contains('CommentContent') ||
      node.closest?.('.CommentContent')) {
    return 'comment';
  }

  // 检查是否为标题区域
  const isHeading = node.matches?.('h1, h2, h3, h4, h5, h6') ||
                    node.closest?.('h1, h2, h3, h4, h5, h6') ||
                    node.classList?.contains('ContentItem-title') ||
                    node.closest?.('.ContentItem-title') ||
                    node.classList?.contains('QuestionItem-title') ||
                    node.closest?.('.QuestionItem-title');

  if (isHeading) {
    return 'title';
  }

  // 默认为内容
  return 'content';
}

window.addEventListener('load', () => {
  document.addEventListener('mouseup', () => {
    handleChromeError(() => {
      const selection = window.getSelection().toString().trim();
      if (!selection) return;
      
      const type = getSelectionType();
      
      // 更新选中区域类型和相关信息
      chrome.runtime.sendMessage({
        action: "updateContextMenu",
        type: type,
        // 如果是作者区域，传递整个内容容器的信息
        contentContainer: type === 'author' && window.currentContentContainer ? 
          window.currentContentContainer.outerHTML : null
      });
    });
  });
});

document.addEventListener('contextmenu', (event) => {
  event.stopPropagation();
}, true);

// 初始化时加载统计信息
chrome.storage.local.get('stats', function(data) {
  if (data.stats) {
    stats = data.stats;
    // 检查是否需要重置今日统计
    const today = new Date().toDateString();
    if (today !== stats.lastResetDate) {
      stats.today = 0;
      stats.lastResetDate = today;
      chrome.storage.local.set({ stats: stats });
    }
  }
});