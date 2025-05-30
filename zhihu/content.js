// 添加错误处理的包装函数
function handleChromeError(callback) {
  try {
    return callback();
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('[知乎屏蔽] 扩展已重新加载，请刷新页面');
      // 移除所有事件监听器
      if (observer) {
        observer.disconnect();
      }
      // 清理已处理记录
      processedItems.clear();
      // 移除所有消息监听器
      if (chrome.runtime.onMessage.hasListeners()) {
        chrome.runtime.onMessage.removeListener();
      }
      // 可以选择自动刷新页面
      // window.location.reload();
      return null;
    } else {
      console.error('[知乎屏蔽] 发生错误:', error);
      throw error;
    }
  }
}

// 添加标题选择器常量
const TITLE_SELECTORS = [
  '.ContentItem-title',
  '.QuestionItem-title',
  '.HotItem-title',
  '.List-item-title',
  '.Card-title',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  '[class*="title"]'
].join(', ');

// 添加文本清理函数
function cleanText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // 移除零宽字符
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // 移除表情符号
    .replace(/[，,]/g, '，') // 统一中文逗号
    .replace(/[。.]/g, '。') // 统一中文句号
    .replace(/\s+/g, ' ') // 统一空格
    .toLowerCase();
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

// 使用防抖包装 filterContent，并添加错误处理
const debouncedFilterContent = debounce(() => {
  handleChromeError(() => {
    filterContent();
  });
}, 300);

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

// 添加检查扩展上下文是否有效的函数
function isExtensionContextValid() {
  try {
    // 尝试访问 chrome.runtime.id，如果扩展上下文无效会抛出错误
    return !!chrome.runtime.id;
  } catch (error) {
    return false;
  }
}

// 修改评论选择器常量，使用更稳定的选择器
const COMMENT_SELECTORS = {
  container: '[data-id]',
  content: '.CommentContent',
  author: 'a[href*="/people/"]',
  parent: '[data-id]',
  list: '[data-id]',
  reply: '[data-id]',
  replyAuthor: 'a[href*="/people/"]',
  replyContent: '.CommentContent',
  replyContainer: '[data-id]'
};

// 添加评论显示/隐藏状态管理
const commentStates = new Map();

// 添加评论处理状态管理
const commentProcessingState = new Map();

// 添加全局的已处理评论ID集合
const processedCommentIds = new Set();

// 添加全局变量来跟踪已处理的标题
const processedTitles = new Set();

// 修改 processCommentList 函数，清理调试信息
function processCommentList(list) {
  // 获取所有评论容器
  const allComments = list.querySelectorAll('[data-id]');
  
  const newComments = Array.from(allComments).filter(comment => {
    const commentId = comment.getAttribute('data-id');
    return commentId && !processedCommentIds.has(commentId);
  });

  if (newComments.length === 0) {
    return;
  }

  newComments.forEach(comment => {
    const commentId = comment.getAttribute('data-id');
    if (!commentId || processedCommentIds.has(commentId)) return;
    
    processedCommentIds.add(commentId);

    if (commentProcessingState.has(commentId)) return;

    commentProcessingState.set(commentId, true);

    try {
      // 从 storage 获取最新的关键词
      chrome.storage.sync.get({ commentKeywords: '', authorKeywords: '' }, function(items) {
        try {
          const authorKeywordsArray = items.authorKeywords
            ? items.authorKeywords.split('\n')
                .map(k => k?.trim().toLowerCase())
                .filter(k => k)
            : [];

          const commentKeywordsArray = items.commentKeywords
            ? items.commentKeywords.split('\n')
                .map(k => k?.trim().toLowerCase())
                .filter(k => k)
            : [];

          // 检查是否需要屏蔽
          let shouldHide = false;
          let blockReason = '';
          let matchedKeyword = '';

          // 1. 检查作者名
          let authorName = '';
          let authorElement = null;

          // 获取作者名元素
          const authorNameElements = comment.querySelectorAll('a[href*="/people/"]');
          
          for (const element of authorNameElements) {
            // 获取完整的作者名文本
            const nameText = element.textContent
              .trim()
              .replace(/\s+/g, ' ')
              .replace(/[\u200B-\u200D\uFEFF]/g, '')
              .toLowerCase();

            // 确保作者名不为空且不是回复标记
            if (nameText && !nameText.includes('回复')) {
              authorName = nameText;
              authorElement = element;
              break;
            }
          }

          // 如果上面的方法没有找到作者名，尝试其他方法
          if (!authorName) {
            // 尝试从评论头部获取作者名
            const commentHeader = comment.querySelector('.CommentItemV2-meta, [class*="css-"]');
            if (commentHeader) {
              const authorLink = commentHeader.querySelector('a[href*="/people/"]');
              if (authorLink) {
                authorName = authorLink.textContent
                  .trim()
                  .replace(/\s+/g, ' ')
                  .replace(/[\u200B-\u200D\uFEFF]/g, '')
                  .toLowerCase();
                authorElement = authorLink;
              }
            }
          }

          // 检查作者关键词
          if (authorName) {
            const matchedAuthorKeyword = authorKeywordsArray.find(keyword => {
              if (!keyword) return false;
              const cleanKeyword = cleanText(keyword);
              const cleanAuthorName = cleanText(authorName);
              return cleanAuthorName === cleanKeyword || cleanAuthorName.includes(cleanKeyword);
            });

            if (matchedAuthorKeyword) {
              shouldHide = true;
              blockReason = 'author';
              matchedKeyword = matchedAuthorKeyword;
            }
          }

          // 2. 如果作者没有匹配，检查评论内容
          if (!shouldHide) {
            const contentElement = comment.querySelector('.CommentContent');
            if (contentElement) {
              const textNodes = [];
              function getTextNodes(node) {
                if (!node) return;
                if (node.nodeType === 3) {
                  const text = node.textContent.trim();
                  if (text) textNodes.push(text);
                } else if (node.nodeType === 1) {
                  if (!node.matches('a[href*="/people/"]')) {
                    Array.from(node.childNodes).forEach(getTextNodes);
                  }
                }
              }
              getTextNodes(contentElement);
              
              const commentText = textNodes.join(' ')
                .replace(/\[.*?\]/g, '')
                .replace(/\s+/g, ' ')
                .replace(/[，,]/g, '，')
                .replace(/[。.]/g, '。')
                .trim()
                .toLowerCase();

              const matchedCommentKeyword = commentKeywordsArray.find(keyword => {
                if (!keyword) return false;
                const processedKeyword = cleanText(keyword);
                return processedKeyword && commentText.includes(processedKeyword);
              });

              if (matchedCommentKeyword) {
                shouldHide = true;
                blockReason = 'comment';
                matchedKeyword = matchedCommentKeyword;
              }
            }
          }

          // 3. 统一处理评论显示状态
          const currentState = commentStates.get(commentId);
          if (!currentState || currentState.hidden !== shouldHide) {
            if (shouldHide) {
              // 直接使用评论容器
              updateCommentVisibility(comment, true);
              processedItems.add(commentId);
              
              // 根据屏蔽原因输出不同的日志
              if (blockReason === 'author') {
                console.log(
                  `[知乎屏蔽] [评论作者] (触发关键词: [%c${matchedKeyword}%c]) (ID: ${commentId}): ${authorName}`,
                  'color: red; font-weight: bold;',
                  'color: inherit;'
                );
                updateStats('author');
              } else {
                console.log(
                  `[知乎屏蔽] [评论] (触发关键词: [%c${matchedKeyword}%c]) (ID: ${commentId})`,
                  'color: red; font-weight: bold;',
                  'color: inherit;'
                );
                updateStats('comment');
              }
            } else {
              updateCommentVisibility(comment, false);
              processedItems.delete(commentId);
            }
          }
        } catch (error) {
          console.error('[知乎屏蔽] 处理评论关键词时出错:', error);
        } finally {
          commentProcessingState.delete(commentId);
        }
      });
    } catch (error) {
      console.error('[知乎屏蔽] 处理评论时出错:', error);
      commentProcessingState.delete(commentId);
    }
  });
}

// 添加查找评论列表的辅助函数
function findCommentLists() {
  // 查找包含评论数量的元素
  const commentCountElements = Array.from(document.querySelectorAll('div'))
    .filter(el => el.textContent.includes('条评论'));
  
  // 返回评论列表容器
  return commentCountElements.map(el => {
    // 向上查找到评论列表容器
    let container = el;
    while (container && !container.querySelector('[data-id]')) {
      container = container.parentElement;
    }
    return container;
  }).filter(Boolean);
}

// 修改 processComments 函数
function processComments() {
  // 获取所有评论列表容器
  const commentLists = findCommentLists();
  
  // 如果没有找到评论列表，尝试其他方式查找评论
  if (commentLists.length === 0) {
    // 尝试直接查找评论容器
    const comments = document.querySelectorAll('[data-id]');
    if (comments.length > 0) {
      // 如果找到了评论，创建一个虚拟的评论列表
      const virtualList = document.createElement('div');
      virtualList.className = 'Comments-container';
      comments.forEach(comment => {
        const commentId = comment.getAttribute('data-id');
        if (commentId && !processedCommentIds.has(commentId)) {
          virtualList.appendChild(comment.cloneNode(true));
        }
      });
      if (virtualList.children.length > 0) {
        processCommentList(virtualList);
      }
    }
  } else {
    // 处理找到的评论列表
    commentLists.forEach(list => {
      const comments = list.querySelectorAll('[data-id]');
      if (comments.length > 0) {
        // 检查是否有新的未处理评论
        const hasNewComments = Array.from(comments).some(comment => {
          const commentId = comment.getAttribute('data-id');
          return commentId && !processedCommentIds.has(commentId);
        });
        
        if (hasNewComments) {
          processCommentList(list);
        }
      }
    });
  }

  // 定期清理过期的评论状态
  const now = Date.now();
  for (const [id, state] of commentStates.entries()) {
    if (now - state.timestamp > 3600000) { // 1小时后清理
      commentStates.delete(id);
      // 同时清理处理状态
      processedCommentIds.delete(id);
    }
  }
}

// 将 debouncedProcessComments 移到全局作用域
let commentProcessTimer = null;

function debouncedProcessComments() {
  // 清除之前的定时器
  if (commentProcessTimer) {
    clearTimeout(commentProcessTimer);
  }
  
  // 设置新的定时器
  commentProcessTimer = setTimeout(() => {
    processComments();
  }, 500); // 延迟500ms处理，等待动态加载
}

function filterContent(authorKeywords, questionKeywords, answerKeywords, commentKeywords, minUpvotes) {
  // 首先检查扩展上下文是否有效
  if (!isExtensionContextValid()) {
    console.log('[知乎屏蔽] 扩展上下文无效，跳过过滤');
    return;
  }

  // 如果屏蔽被禁用，显示所有内容并返回
  if (!isBlockingEnabled) {
    try {
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
    } catch (error) {
      console.error('[知乎屏蔽] 显示内容时出错:', error);
    }
    return;
  }

  // 从 storage 获取最新的关键词
  try {
    chrome.storage.sync.get({
      authorKeywords: '',
      questionKeywords: '',
      answerKeywords: '',
      commentKeywords: '',
      minUpvotes: 0,
      blockingEnabled: true
    }, function(items) {
      // 再次检查扩展上下文是否有效
      if (!isExtensionContextValid()) {
        console.log('[知乎屏蔽] 扩展上下文无效，跳过处理');
        return;
      }

      try {
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

        // 安全地处理关键词数组，添加空格处理
        const safeSplitKeywords = (keywords) => {
          if (!keywords) return [];
          try {
            return keywords.split('\n')
              .map(k => k?.trim().toLowerCase())
              .filter(k => k && k.length > 0); // 过滤掉空值和只包含空格的值
          } catch (error) {
            console.error('[知乎屏蔽] 处理关键词时出错:', error);
            return [];
          }
        };

        const authorKeywordsArray = safeSplitKeywords(items.authorKeywords);
        const questionKeywordsArray = safeSplitKeywords(items.questionKeywords);
        const answerKeywordsArray = safeSplitKeywords(items.answerKeywords);
        const commentKeywordsArray = safeSplitKeywords(items.commentKeywords);

        // 修改内容选择器，确保能捕获到所有类型的内容
        const feedItems = document.querySelectorAll([
          '.Feed',
          '.HotItem',  // 确保包含热榜项
          '.List-item',
          '.TopstoryItem',
          '.Card',
          '.ContentItem',
          '.AnswerItem',
          '.QuestionItem',
          '.TopstoryItem-isRecommend'
        ].join(', '));

        feedItems.forEach(item => {
          // 获取最外层的容器，添加更多可能的选择器
          const container = item.closest([
            '.Card',
            '.TopstoryItem',
            '.Feed',
            '.ContentItem',
            '.AnswerItem',
            '.TopstoryItem-isRecommend',
            '[data-za-detail-view-path-module="FeedItem"]',
            '[data-za-detail-view-path-module="AnswerItem"]'
          ].join(', ')) || item;
          
          // 检查是否已经处理过这个元素
          if (processedItems.has(item) || processedItems.has(container)) {
            return;
          }

          let shouldRemove = false;
          let blockReason = '';
          let triggeredKeyword = '';
          let titleText = '';
          let contentText = '';

          // 检查是否为热榜项
          const isHotItem = item.classList.contains('HotItem');
          
          // 获取标题和内容
          if (isHotItem) {
            // 热榜项的特殊处理
            const titleElement = item.querySelector('.HotItem-title');
            const contentElement = item.querySelector('.HotItem-excerpt');
            
            if (titleElement) {
              titleText = cleanText(titleElement.textContent);
            }
            if (contentElement) {
              contentText = cleanText(contentElement.textContent);
            }
          } else {
            // 原有的标题和内容获取逻辑
            const authorSelectors = [
              '.AuthorInfo-name .UserLink-link',
              '.AuthorInfo-name a[href*="/people/"]',
              '.UserLink-link', 
              'a[href*="/people/"]',
              '.CommentItemV2-meta a[href*="/people/"]'
            ];
            
            let authorName = '';
            for (const selector of authorSelectors) {
              const authorElement = item.querySelector(selector);
              if (authorElement) {
                authorName = authorElement.textContent
                  .trim()
                  .replace(/\s+/g, ' ')
                  .replace(/[\u200B-\u200D\uFEFF]/g, '')
                  .toLowerCase();
                if (authorName) break;
              }
            }

            // 扩展标题选择器，确保能找到标题
            const titleSelectors = [
              '.ContentItem-title',
              '.QuestionItem-title',
              '.HotItem-title',
              '.List-item-title',
              '.Card-title',
              'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
              '[class*="title"]',
              'a[href*="/question/"]',
              'a[href*="/answer/"]'
            ];
            
            for (const selector of titleSelectors) {
              const titleElement = item.querySelector(selector);
              if (titleElement) {
                if (titleElement.tagName === 'A') {
                  titleText = cleanText(titleElement.textContent);
                } else {
                  titleText = cleanText(titleElement.textContent);
                }
                if (titleText) break;
              }
            }
            
            contentElement = item.querySelector('.RichText.ztext');
            if (contentElement) {
              contentText = cleanText(contentElement.textContent);
            }
          }

          // 如果找不到标题，尝试从其他属性获取
          if (!titleText) {
            // 尝试从 data-zop 属性获取标题
            const zopData = item.getAttribute('data-zop-itemid');
            if (zopData) {
              try {
                const zop = JSON.parse(zopData);
                if (zop.title) {
                  titleText = cleanText(zop.title);
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
            
            // 尝试从 meta 标签获取标题
            if (!titleText) {
              const metaTitle = item.querySelector('meta[itemprop="name"]');
              if (metaTitle) {
                titleText = cleanText(metaTitle.getAttribute('content'));
              }
            }
          }

          // 如果仍然找不到标题，跳过处理
          if (!titleText) {
            return;
          }

          // 如果标题已经被处理过，跳过
          if (processedTitles.has(titleText)) {
            return;
          }

          // 检查标题关键词，使用更严格的匹配
          const matchedKeyword = questionKeywordsArray.find(keyword => {
            if (!keyword) return false;
            const cleanKeyword = cleanText(keyword);
            const cleanTitle = cleanText(titleText);
            // 检查完整匹配或部分匹配
            return cleanKeyword && (
              cleanTitle === cleanKeyword || 
              cleanTitle.includes(cleanKeyword) ||
              cleanKeyword.includes(cleanTitle)
            );
          });

          if (matchedKeyword) {
            shouldRemove = true;
            triggeredKeyword = matchedKeyword;
            blockReason = 'title';
            // 修改标题屏蔽日志格式，添加红色样式
            console.log(
              `[知乎屏蔽] [标题] (触发关键词: [%c${triggeredKeyword}%c]) (标题: ${titleText})`,
              'color: red; font-weight: bold;',
              'color: inherit;'
            );
            updateStats('title');
          } else if (contentText && answerKeywordsArray.some(keyword => contentText.includes(cleanText(keyword)))) {
            shouldRemove = true;
            triggeredKeyword = answerKeywordsArray.find(keyword => contentText.includes(cleanText(keyword)));
            blockReason = 'content';
            // 修改内容屏蔽日志格式，使用标题而不是内容预览
            console.log(
              `[知乎屏蔽] [内容] (触发关键词: [%c${triggeredKeyword}%c]) (标题: ${titleText})`,
              'color: red; font-weight: bold;',
              'color: inherit;'
            );
            updateStats('content');
          }

          // 处理屏蔽
          if (shouldRemove) {
            // 隐藏整个内容项及其所有相关容器
            const containersToHide = [
              container,
              item,
              container.closest('.TopstoryItem'),
              container.closest('.Feed'),
              container.closest('.Card'),
              container.closest('.TopstoryItem-isRecommend'),
              container.closest('[data-za-detail-view-path-module="FeedItem"]'),
              container.closest('[data-za-detail-view-path-module="AnswerItem"]')
            ].filter(Boolean); // 过滤掉 null 值

            containersToHide.forEach(container => {
              if (container) {
                container.style.display = 'none';
                processedItems.add(container);
              }
            });
            
            // 记录已处理的标题
            processedTitles.add(titleText);
          } else {
            // 显示内容
            const containersToShow = [
              container,
              item,
              container.closest('.TopstoryItem'),
              container.closest('.Feed'),
              container.closest('.Card'),
              container.closest('.TopstoryItem-isRecommend'),
              container.closest('[data-za-detail-view-path-module="FeedItem"]'),
              container.closest('[data-za-detail-view-path-module="AnswerItem"]')
            ].filter(Boolean); // 过滤掉 null 值

            containersToShow.forEach(container => {
              if (container) {
                container.style.display = '';
                processedItems.delete(container);
              }
            });
            
            // 移除已处理的标题记录
            if (titleText) {
              processedTitles.delete(titleText);
            }
          }
        });

        // 处理评论
        processComments();

        // 定期清理过期的评论状态
        const now = Date.now();
        for (const [id, state] of commentStates.entries()) {
          if (now - state.timestamp > 3600000) { // 1小时后清理
            commentStates.delete(id);
          }
        }

        // 定期清理已处理记录，避免内存泄漏
        if (processedItems.size > 1000) {
          processedItems.clear();
        }
      } catch (error) {
        console.error('[知乎屏蔽] 处理内容时出错:', error);
      }
    });
  } catch (error) {
    console.error('[知乎屏蔽] 获取存储数据时出错:', error);
  }
}

// 修改观察器配置
const observer = new MutationObserver((mutations) => {
  handleChromeError(() => {
    // 检查是否有内容变化
    const hasContentChanges = mutations.some(mutation => {
      // 检查新增节点
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === 1) { // 元素节点
          // 检查是否包含未处理的内容
          const newContent = node.querySelector?.(TITLE_SELECTORS);
          if (newContent) {
            const titleText = cleanText(newContent.textContent);
            return titleText && !processedTitles.has(titleText);
          }
          return false;
        }
        return false;
      });
    });

    if (hasContentChanges) {
      // 只处理新内容，不清除已处理记录
      filterContent();
    }

    // 检查是否有评论相关的变化
    const hasCommentChanges = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === 1) { // 元素节点
          // 检查是否包含评论数量文本
          if (node.textContent && node.textContent.includes('条评论')) {
            return true;
          }
          // 检查是否包含评论容器
          return node.querySelector?.(COMMENT_SELECTORS.container) !== null;
        }
        return false;
      });
    });

    if (hasCommentChanges) {
      debouncedProcessComments();
    }
  });
});

// 修改初始化代码
window.addEventListener('load', () => {
  handleChromeError(() => {
    // 开始观察 DOM 变化
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-id', 'data-zop-itemid', 'data-comment-id', 'data-za-detail-view-path-module', 'data-za-extra-module']
    });

    // 初始加载时执行过滤
    filterContent();

    // 初始处理评论
    debouncedProcessComments();

    // 添加鼠标事件监听
    document.addEventListener('mouseup', () => {
      handleChromeError(() => {
        const selection = window.getSelection().toString().trim();
        if (!selection) return;
        
        const type = getSelectionType();
        
        // 更新选中区域类型和相关信息
        chrome.runtime.sendMessage({
          action: "updateContextMenu",
          type: type,
          contentContainer: type === 'author' && window.currentContentContainer ? 
            window.currentContentContainer.outerHTML : null
        });
      });
    });
  });
});

// 添加 DOMContentLoaded 事件监听，确保在 DOM 加载完成后就开始过滤
document.addEventListener('DOMContentLoaded', () => {
  handleChromeError(() => {
    // 开始观察 DOM 变化
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-id', 'data-zop-itemid', 'data-comment-id', 'data-za-detail-view-path-module', 'data-za-extra-module']
    });

    // 初始加载时执行过滤
    filterContent();
  });
});

document.addEventListener('contextmenu', (event) => {
  event.stopPropagation();
}, true);

// 初始化时加载统计信息，添加错误处理
handleChromeError(() => {
  chrome.storage.local.get('stats', function(data) {
    handleChromeError(() => {
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
  });
});

// 修改 updateCommentVisibility 函数，清理调试信息
function updateCommentVisibility(commentContainer, shouldHide) {
  if (!commentContainer) return;
  
  const commentId = commentContainer.getAttribute('data-id');
  if (!commentId) return;

  // 保存评论状态
  commentStates.set(commentId, {
    hidden: shouldHide,
    timestamp: Date.now()
  });

  // 更新显示状态
  commentContainer.style.display = shouldHide ? 'none' : '';

  // 触发事件
  const event = new CustomEvent('commentVisibilityChanged', {
    detail: { commentId, shouldHide }
  });
  document.dispatchEvent(event);
}

// 移除评论状态监听器的日志输出
document.removeEventListener('commentVisibilityChanged', (event) => {
  const { commentId, shouldHide } = event.detail;
});

// 修改 getSelectionType 函数，优化作者区域检测
function getSelectionType() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer;

  // 获取选中文本所在的元素
  const node = element.nodeType === 3 ? element.parentNode : element;

  // 获取选中的文本，并清理空格
  const selectedText = selection.toString().trim();
  if (!selectedText) return null;

  // 检查是否为作者区域
  const isAuthorArea = (node) => {
    // 检查当前节点或其父节点是否是作者链接
    const authorLink = node.closest('a[href*="/people/"]');
    if (!authorLink) return false;

    // 获取作者链接中的实际文本
    const authorText = authorLink.textContent.trim();
    
    // 检查选中的文本是否与作者名匹配
    if (authorText === selectedText || authorText.includes(selectedText) || selectedText.includes(authorText)) {
      // 保存容器的引用，以便后续使用
      window.currentContentContainer = authorLink;
      // 使用完整的作者名作为屏蔽关键词
      window.currentSelectedText = authorText
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '');
      return true;
    }
    return false;
  };

  // 检查是否为评论内容区域
  const isCommentContent = (node) => {
    const commentContainer = node.closest('[data-id]');
    if (!commentContainer) return false;
    
    // 确保不是作者链接
    const authorLink = node.closest('a[href*="/people/"]');
    if (authorLink) return false;
    
    return node.closest('.CommentContent') !== null;
  };

  // 检查是否为标题区域
  const isHeading = (node) => {
    return node.closest('h1, h2, h3, h4, h5, h6, [class*="title"]') !== null;
  };

  // 按优先级检查区域类型
  if (isAuthorArea(node)) {
    return 'author';
  }
  
  if (isCommentContent(node)) {
    return 'comment';
  }
  
  if (isHeading(node)) {
    return 'title';
  }

  return 'content';
}

// 定期清理评论处理状态
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamp] of commentProcessingState.entries()) {
    if (now - timestamp > 5000) { // 5秒后清理
      commentProcessingState.delete(id);
    }
  }
}, 60000); // 每分钟检查一次

// 修改消息处理部分
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const result = handleChromeError(() => {
    // 处理所有可能包含 enabled 状态的消息
    if (request.enabled !== undefined) {
      isBlockingEnabled = request.enabled;
    }

    if (request.action === "updateBlockingState") {
      // 清除已处理记录，确保重新检查所有内容
      processedItems.clear();
      // 立即执行过滤
      filterContent();
      // 发送响应
      sendResponse({ success: true });
    } else if (request.action === "updateFilter" || request.action === "deleteKeyword") {
      // 清除所有状态
      processedItems.clear();
      processedTitles.clear();
      commentStates.clear();
      processedCommentIds.clear();
      // 重新处理所有内容
      filterContent();
      // 立即处理评论
      processComments();
      sendResponse({ success: true });
    } else if (request.action === "addTitle") {
      chrome.storage.sync.get({ questionKeywords: '' }, function(items) {
        handleChromeError(() => {
          const newKeywords = items.questionKeywords + (items.questionKeywords ? '\n' : '') + request.text;
          chrome.storage.sync.set({ questionKeywords: newKeywords }, function() {
            console.log('[知乎屏蔽] 标题关键词已添加:', request.text);
            // 清除已处理记录
            processedItems.clear();
            // 立即执行过滤
            filterContent();
          });
        });
      });
    } else if (request.action === "addContent") {
      chrome.storage.sync.get({ answerKeywords: '' }, function(items) {
        handleChromeError(() => {
          const newKeywords = items.answerKeywords + (items.answerKeywords ? '\n' : '') + request.text;
          chrome.storage.sync.set({ answerKeywords: newKeywords }, function() {
            console.log('[知乎屏蔽] 内容关键词已添加:', request.text);
            // 清除已处理记录
            processedItems.clear();
            // 立即执行过滤
            filterContent();
          });
        });
      });
    } else if (request.action === "addAuthor") {
      chrome.storage.sync.get({ authorKeywords: '' }, function(items) {
        handleChromeError(() => {
          // 使用清理后的选中文本
          const textToAdd = window.currentSelectedText || request.text.trim();
          // 检查是否已存在该关键词
          const existingKeywords = items.authorKeywords ? items.authorKeywords.split('\n') : [];
          if (!existingKeywords.includes(textToAdd)) {
            const newKeywords = items.authorKeywords + (items.authorKeywords ? '\n' : '') + textToAdd;
            chrome.storage.sync.set({ authorKeywords: newKeywords }, function() {
              console.log('[知乎屏蔽] 作者关键词已添加:', textToAdd);
              // 清除已处理记录
              processedItems.clear();
              processedCommentIds.clear();  // 清除已处理的评论记录
              commentStates.clear();        // 清除评论状态
              // 立即执行评论处理
              processComments();
              // 同时执行内容过滤
              filterContent();
            });
          } else {
            console.log('[知乎屏蔽] 作者关键词已存在:', textToAdd);
          }
        });
      });
    } else if (request.action === "addComment") {
      chrome.storage.sync.get({ commentKeywords: '' }, function(items) {
        handleChromeError(() => {
          const newKeywords = items.commentKeywords + (items.commentKeywords ? '\n' : '') + request.text;
          chrome.storage.sync.set({ commentKeywords: newKeywords }, function() {
            console.log('[知乎屏蔽] 评论关键词已添加:', request.text);
            // 清除已处理记录
            processedItems.clear();
            processedCommentIds.clear();  // 清除已处理的评论记录
            commentStates.clear();        // 清除评论状态
            // 立即执行评论处理，不使用防抖
            processComments();
            // 同时执行内容过滤
            filterContent();
          });
        });
      });
    }
  });

  // 如果处理过程中发生错误，返回错误信息
  if (result === null) {
    sendResponse({ success: false, error: 'Extension context invalidated' });
  }
  return true; // 保持消息通道开放
});