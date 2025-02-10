document.addEventListener('DOMContentLoaded', function() {
  // 加载已保存的关键词
  chrome.storage.sync.get({
    authorKeywords: '',
    questionKeywords: '',
    answerKeywords: ''
  }, function(items) {
    document.getElementById('authorKeywords').value = items.authorKeywords;
    document.getElementById('questionKeywords').value = items.questionKeywords;
    document.getElementById('answerKeywords').value = items.answerKeywords;
  });

  // 保存设置
  document.getElementById('saveButton').addEventListener('click', function() {
    const authorKeywords = document.getElementById('authorKeywords').value;
    const questionKeywords = document.getElementById('questionKeywords').value;
    const answerKeywords = document.getElementById('answerKeywords').value;

    chrome.storage.sync.set({
      authorKeywords: authorKeywords,
      questionKeywords: questionKeywords,
      answerKeywords: answerKeywords
    }, function() {
      const status = document.getElementById('status');
      status.textContent = '设置已保存';
      setTimeout(function() {
        status.textContent = '';
      }, 2000);
    });
  });
}); 