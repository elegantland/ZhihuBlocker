// 监听扩展程序启用/禁用状态
chrome.management.onEnabled.addListener(function(info) {
  console.log("Extension Enabled");
  updateIcon(true);
});

chrome.management.onDisabled.addListener(function(info) {
  console.log("Extension Disabled");
  updateIcon(false);
});

// 监听 storage 变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.blockingEnabled !== undefined) { // 修改这里
    const enabled = changes.blockingEnabled.newValue;
    updateIcon(enabled);
  }
});

// 初始设置图标
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ blockingEnabled: true }, ({ blockingEnabled }) => {
    updateIcon(blockingEnabled);
  });

  // 创建右键菜单
  chrome.contextMenus.create({
    id: "addToFilter",
    title: "添加到知乎过滤器",
    contexts: ["selection"]
  });
});

// 更新图标函数
function updateIcon(enabled) {
  const iconPath = {
    "32": `icons/icon-${enabled ? 'enabled' : 'disabled'}-32.png`
  };
  chrome.action.setIcon({ path: iconPath });
}

// 处理菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText;

  // 获取当前存储的选中区域类型
  chrome.storage.local.get('selectedType', ({ selectedType }) => {
    // 根据区域类型发送不同的消息
    let action;
    switch (selectedType) {
      case 'title':
        action = "addTitle";
        break;
      case 'content':
        action = "addContent";
        break;
      case 'author':
        action = "addAuthor";
        break;
      case 'comment':
        action = "addComment";
        break;
    }

    chrome.tabs.sendMessage(tab.id, {
      action: action,
      text: selectedText
    });
  });
});

// 监听来自content script的消息,保存选中区域类型并更新菜单标题
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === "updateContextMenu") {
    // 保存选中区域类型
    chrome.storage.local.set({ selectedType: request.type });

    // 根据类型更新菜单标题
    let title;
    switch (request.type) {
      case 'title':
        title = "知乎屏蔽：添加到标题屏蔽";
        break;
      case 'content':
        title = "知乎屏蔽：添加到内容屏蔽";
        break;
      case 'author':
        title = "知乎屏蔽：添加到作者屏蔽";
        break;
      case 'comment':
        title = "知乎屏蔽：添加到评论屏蔽";
        break;
    }

    chrome.contextMenus.update("addToFilter", {
      title: title
    });
  }
}); 
