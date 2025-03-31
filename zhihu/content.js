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

function filterContent() {
  handleChromeError(() => {
    chrome.storage.sync.get({
      blockingEnabled: true,  // 默认启用
      authorKeywords: '',
      questionKeywords: '',
      answerKeywords: '',
      commentKeywords: '' // 新增评论关键词
    }, function(items) {
      // 如果屏蔽被禁用，显示所有内容
      if (!items.blockingEnabled) {
        document.querySelectorAll('.Feed, .HotItem, .TopstoryItem, .List-item').forEach(feed => {
          const container = feed.closest('.TopstoryItem, .Card, .List-item') || feed;
          container.style.display = '';
        });
        return;
      }

      // 过滤内容逻辑
      const feeds = document.querySelectorAll('.Feed, .HotItem, .TopstoryItem, .List-item');
      
      feeds.forEach(feed => {
        const author = feed.querySelector('.AuthorInfo-name')?.textContent || 
                      feed.querySelector('.UserLink-link')?.textContent || '';
        
        const question = feed.querySelector('.ContentItem-title, .HotItem-title, .QuestionItem-title')?.textContent || '';
        const answer = feed.querySelector('.RichText, .HotItem-excerpt, .ContentItem-content')?.textContent || '';
        
        const hasFilteredComments = feed.querySelector('.css-1tdhe7b')?.textContent === '评论内容由作者筛选后展示';

        const isAuthorBlocked = checkKeywords(author, items.authorKeywords);

        const container = feed.closest('[data-id]') || feed;

        if (isAuthorBlocked || 
            checkKeywords(question, items.questionKeywords) ||
            checkKeywords(answer, items.answerKeywords) ||
            hasFilteredComments) {
          container.style.display = 'none';
        } else {
          container.style.display = '';
        }
      });

      // 过滤评论
      document.querySelectorAll('.CommentContent').forEach(comment => {
        const commentContainer = comment.closest('[data-id]');
        
        const mainAuthorLink = commentContainer?.querySelector('.css-10u695f');
        const mainAuthor = mainAuthorLink?.textContent?.trim() || '';

        const isAuthorBlocked = checkKeywords(mainAuthor, items.authorKeywords);
        
        if (isAuthorBlocked || checkKeywords(comment.textContent, items.commentKeywords)) {
          commentContainer.style.display = 'none';
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
    if (request.action === "updateBlockingState") {
      filterContent();  // 重新过滤
    } else if (request.action === "updateFilter") {
      filterContent();  // 重新过滤
    } else if (request.action === "addTitle") {
      // 处理添加标题
      chrome.storage.sync.get({ questionKeywords: '' }, function(items) {
        const newKeywords = items.questionKeywords + (items.questionKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ questionKeywords: newKeywords }, function() {
          console.log('Title keyword added:', request.text);
          filterContent();
        });
      });
    } else if (request.action === "addContent") {
      // 处理添加内容
      chrome.storage.sync.get({ answerKeywords: '' }, function(items) {
        const newKeywords = items.answerKeywords + (items.answerKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ answerKeywords: newKeywords }, function() {
          console.log('Content keyword added:', request.text);
          filterContent();
        });
      });
    } else if (request.action === "addAuthor") {
      // 处理添加作者
      chrome.storage.sync.get({ authorKeywords: '' }, function(items) {
        const newKeywords = items.authorKeywords + (items.authorKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ authorKeywords: newKeywords }, function() {
          console.log('Author keyword added:', request.text);
          filterContent();
        });
      });
    } else if (request.action === "addComment") { // 添加评论关键词
      chrome.storage.sync.get({ commentKeywords: '' }, function(items) {
        const newKeywords = items.commentKeywords + (items.commentKeywords ? '\n' : '') + request.text;
        chrome.storage.sync.set({ commentKeywords: newKeywords }, function() {
          console.log('Comment keyword added:', request.text);
          filterContent();
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