// Henry's Kitchen — small page behaviours. No libraries, no tracking.
//
//  * Click-to-load video: nothing from YouTube loads until a visitor presses play.
//    Any element with data-play="<player id>" and data-start="<seconds>" loads
//    (or restarts) that player at that point in the episode. A player inside
//    [data-float] floats in the corner while its spot is scrolled off screen.
//  * Print and Share buttons.

(function () {
  'use strict';

  // Build the privacy-enhanced YouTube embed address for a video and start time.
  function embedUrl(videoId, startSeconds) {
    var start = Math.max(0, parseInt(startSeconds, 10) || 0);
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) +
      '?autoplay=1&rel=0&start=' + start;
  }

  // Remembers each player's original "press play" button, so closing the
  // floating video can put it back.
  var originals = {};

  // Replace the placeholder (or the current iframe) with a player at the given time.
  function loadPlayer(playerId, startSeconds) {
    var slot = document.getElementById(playerId);
    if (!slot) { return; }

    var videoId = slot.getAttribute('data-video');
    var title = slot.getAttribute('data-title') || 'Henry’s Kitchen episode';
    if (slot.tagName !== 'IFRAME') { originals[playerId] = slot; }

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

    // On recipe pages the video can float in the corner, so pressing a step's time
    // further down plays it without scrolling away from the step.
    var floater = frame.closest('[data-float]');
    if (floater) {
      watchFloating(floater, playerId);
    } else {
      frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Floats the playing video in the corner whenever its usual spot is off screen.
  function watchFloating(floater, playerId) {
    var home = floater.parentElement;
    if (!floater.querySelector('.float-close')) {
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'float-close';
      close.setAttribute('aria-label', 'Stop the video');
      close.textContent = '\u00D7';
      close.addEventListener('click', function () {
        var frame = document.getElementById(playerId);
        if (frame && originals[playerId]) { frame.replaceWith(originals[playerId]); }
        floater.classList.remove('is-floating');
      });
      floater.appendChild(close);
    }

    var setFloating = function (onScreen) {
      var playing = !!floater.querySelector('iframe');
      floater.classList.toggle('is-floating', playing && !onScreen);
    };

    if ('IntersectionObserver' in window) {
      if (!floater.observer) {
        floater.observer = new IntersectionObserver(function (entries) {
          setFloating(entries[0].isIntersecting);
        }, { threshold: 0.25 });
        floater.observer.observe(home);
      }
      var box = home.getBoundingClientRect();
      setFloating(box.bottom > 0 && box.top < window.innerHeight);
    }
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
        }).catch(function () { showLink(shareData.url); });
      } else {
        showLink(shareData.url);
      }
    }
  });

  // When the browser won't share or copy, show the address so it can be copied by hand.
  function showLink(url) {
    window.prompt('Copy this link:', url);
  }
})();
