// script.js – subtle animations, no content rendering
document.addEventListener('DOMContentLoaded', function() {
  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if(target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Hamburger menu toggle
  const hamburger = document.querySelector('.hamburger');
  const nav = document.querySelector('.nav');
  if (hamburger) {
    hamburger.addEventListener('click', function() {
      this.classList.toggle('active');
      nav.classList.toggle('active');
    });
  }

  // Dropdown hover for desktop + click for mobile
  const dropdowns = document.querySelectorAll('.dropdown');
  let timeoutId;

  // Function to handle window resize
  function handleResize() {
    if (window.innerWidth > 768) {
      // Desktop: hover behavior
      dropdowns.forEach(dropdown => {
        // Remove any click listeners to avoid conflict
        dropdown.removeEventListener('click', dropdownClickHandler);
        // Ensure hover works
        dropdown.addEventListener('mouseenter', function() {
          clearTimeout(timeoutId);
          this.classList.add('open');
        });
        dropdown.addEventListener('mouseleave', function() {
          timeoutId = setTimeout(() => {
            this.classList.remove('open');
          }, 200);
        });
      });
    } else {
      // Mobile: click behavior
      dropdowns.forEach(dropdown => {
        // Remove hover listeners
        dropdown.removeEventListener('mouseenter', null);
        dropdown.removeEventListener('mouseleave', null);
        // Add click listener
        dropdown.addEventListener('click', dropdownClickHandler);
      });
    }
  }

  function dropdownClickHandler(e) {
    // Prevent closing if clicking inside dropdown content
    if (e.target.closest('.dropdown-content')) return;
    const dropdown = e.currentTarget;
    dropdown.classList.toggle('open');
  }

  // Initial call
  handleResize();
  window.addEventListener('resize', handleResize);

  // #region agent log (dropdown hover debug)
  (function debugDropdownHover() {
    try {
      const endpoint = 'http://127.0.0.1:7458/ingest/1b7bcb67-0e60-47ea-8005-38b988580baf';
      const sessionId = '5372d8';
      const runId = 'dropdown-debug-1';
      let seq = 0;
      const maxLogs = 10;

      function post(hypothesisId, location, message, data) {
        if (seq >= maxLogs) return;
        seq++;
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
          body: JSON.stringify({
            sessionId,
            runId,
            hypothesisId,
            location,
            message,
            data,
            timestamp: Date.now()
          })
        }).catch(() => {});
      }

      const dropdownList = Array.from(document.querySelectorAll('.dropdown'));
      dropdownList.forEach((dropdown, idx) => {
        const content = dropdown.querySelector('.dropdown-content');

        dropdown.addEventListener('mouseenter', function(e) {
          post(
            'H1_dropdown_enters',
            'script.js:debugDropdownHover:mouseenter',
            'dropdown mouseenter',
            {
              idx,
              innerWidth: window.innerWidth,
              openClass: dropdown.classList.contains('open'),
              clientX: e.clientX,
              clientY: e.clientY
            }
          );
        });

        dropdown.addEventListener('mouseleave', function(e) {
          post(
            'H2_dropdown_leave',
            'script.js:debugDropdownHover:mouseleave',
            'dropdown mouseleave',
            {
              idx,
              innerWidth: window.innerWidth,
              openClass: dropdown.classList.contains('open'),
              clientX: e.clientX,
              clientY: e.clientY,
              relatedInContent:
                !!(e.relatedTarget && content && e.relatedTarget.closest && e.relatedTarget.closest('.dropdown-content'))
            }
          );
        });

        if (content) {
          content.addEventListener('pointerenter', function(e) {
            post(
              'H3_content_pointerenter',
              'script.js:debugDropdownHover:content:pointerenter',
              'dropdown-content pointerenter',
              {
                idx,
                innerWidth: window.innerWidth,
                openClass: dropdown.classList.contains('open'),
                clientX: e.clientX,
                clientY: e.clientY,
                isContentHover: content.matches(':hover'),
                contentComputedDisplay: getComputedStyle(content).display
              }
            );
          });
        }
      });
    } catch (err) {
      // ignore logging errors
    }
  })();
  // #endregion

  // #region agent log (mobile button size debug)
  (function debugMobileButtons() {
    try {
      const endpoint = 'http://127.0.0.1:7458/ingest/1b7bcb67-0e60-47ea-8005-38b988580baf';
      const sessionId = '5372d8';
      const runId = 'buttons-pre-fix';

      // Buttons appear on service pages like "small-business-web-design.html"
      const fiverrBtn = document.querySelector('a.btn[href^="https://www.fiverr.com/bca5434/build-seo-friendly-marketing-websites-for-small-business"]');
      const waBtn = document.querySelector('a.btn.btn-outline[href^="https://wa.me/6009825938"]');
      if (!fiverrBtn || !waBtn) return;

      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      const fiverrRect = fiverrBtn.getBoundingClientRect();
      const waRect = waBtn.getBoundingClientRect();
      const fiverrStyle = getComputedStyle(fiverrBtn);
      const waStyle = getComputedStyle(waBtn);

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
        body: JSON.stringify({
          sessionId,
          runId,
          hypothesisId: 'H1_button_padding_height_or_wrapping',
          location: 'script.js:debugMobileButtons',
          message: 'Measure Fiverr/WhatsApp button geometry at current viewport',
          data: {
            viewportW,
            viewportH,
            fiverr: {
              rect: {
                left: fiverrRect.left,
                right: fiverrRect.right,
                width: fiverrRect.width,
                top: fiverrRect.top,
                height: fiverrRect.height
              },
              paddingTop: fiverrStyle.paddingTop,
              paddingBottom: fiverrStyle.paddingBottom,
              paddingLeft: fiverrStyle.paddingLeft,
              paddingRight: fiverrStyle.paddingRight,
              fontSize: fiverrStyle.fontSize,
              lineHeight: fiverrStyle.lineHeight,
              whiteSpace: fiverrStyle.whiteSpace,
              clientRectsCount: fiverrBtn.getClientRects().length
            },
            whatsapp: {
              rect: {
                left: waRect.left,
                right: waRect.right,
                width: waRect.width,
                top: waRect.top,
                height: waRect.height
              },
              paddingTop: waStyle.paddingTop,
              paddingBottom: waStyle.paddingBottom,
              paddingLeft: waStyle.paddingLeft,
              paddingRight: waStyle.paddingRight,
              fontSize: waStyle.fontSize,
              lineHeight: waStyle.lineHeight,
              whiteSpace: waStyle.whiteSpace,
              clientRectsCount: waBtn.getClientRects().length
            }
          },
          timestamp: Date.now()
        })
      }).catch(() => {});
    } catch (err) {
      // ignore logging errors
    }
  })();
  // #endregion
});