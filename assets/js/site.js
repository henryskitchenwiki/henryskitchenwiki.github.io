// Henry's Kitchen — small page behaviours. No libraries, no tracking.
//
//  * Click-to-load video: nothing from YouTube loads until a visitor presses play.
//    Any element with data-play="<player id>" and data-start="<seconds>" loads
//    (or restarts) that player at that point in the episode.
//  * Print and Share buttons.

(function () {
  'use strict';

  // Build the privacy-enhanced YouTube embed address for a video and start time.
  function embedUrl(videoId, startSeconds) {
    var start = Math.max(0, parseInt(startSeconds, 10) || 0);
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) +
      '?autoplay=1&rel=0&start=' + start;
  }

  // Replace the placeholder (or the current iframe) with a player at the given time.
  function loadPlayer(playerId, startSeconds) {
    var slot = document.getElementById(playerId);
    if (!slot) { return; }

    var videoId = slot.getAttribute('data-video');
    var title = slot.getAttribute('data-title') || 'Henry’s Kitchen episode';

    var frame = document.createElement('iframe');
    frame.className = 'player-frame';
    frame.src = embedUrl(videoId, startSeconds);
    frame.title = title;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.id = playerId;
    frame.setAttribute('data-video', videoId);
    frame.setAttribute('data-title', title);

    slot.replaceWith(frame);
    frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.addEventListener('click', function (event) {
    var playButton = event.target.closest('[data-play]');
    if (playButton) {
      loadPlayer(playButton.getAttribute('data-play'), playButton.getAttribute('data-start'));
      return;
    }

    if (event.target.closest('[data-print]')) {
      window.print();
      return;
    }

    var shareButton = event.target.closest('[data-share]');
    if (shareButton) {
      var shareData = { title: document.title, url: window.location.href };
      if (navigator.share) {
        navigator.share(shareData).catch(function () { /* visitor closed the share sheet */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(shareData.url).then(function () {
          var original = shareButton.textContent;
          shareButton.textContent = 'Link copied';
          setTimeout(function () { shareButton.textContent = original; }, 2000);
        });
      }
    }
  });
})();
