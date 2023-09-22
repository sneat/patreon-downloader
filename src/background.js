chrome.runtime.onMessage.addListener(
  function (message, sender, sendResponse) {
    switch (message.type) {
      case 'whoAmI':
        sendResponse({tab: sender.tab.id});
        break;
    }
  },
);
