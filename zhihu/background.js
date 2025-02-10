// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  // 创建单个菜单项
  chrome.contextMenus.create({
    id: "addToFilter",
    title: "添加到知乎过滤器",
    contexts: ["selection"]
  });
});

// 处理菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText;
  
  // 获取当前存储的选中区域类型
  chrome.storage.local.get('selectedType', ({ selectedType }) => {
    // 根据区域类型发送不同的消息
    chrome.tabs.sendMessage(tab.id, {
      action: selectedType === 'title' ? "addTitle" : "addContent",
      text: selectedText
    });
  });
});

// 监听来自content script的消息,保存选中区域类型并更新菜单标题
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === "updateContextMenu") {
    // 保存选中区域类型
    chrome.storage.local.set({ selectedType: request.type });
    
    // 更新菜单标题
    const title = request.type === 'title' ? 
      "知乎屏蔽：添加到标题屏蔽" : 
      "知乎屏蔽：添加到内容屏蔽";
    
    chrome.contextMenus.update("addToFilter", {
      title: title
    });
  }
}); 
