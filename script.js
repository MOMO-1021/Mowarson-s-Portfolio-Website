// script.js – smooth scrolling, hamburger menu, and dropdown navigation
document.addEventListener('DOMContentLoaded', function() {
  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });

  // Logo click: smooth scroll to top on home page without bouncing/reloading
  document.querySelectorAll('.logo').forEach(logo => {
    logo.addEventListener('click', function(e) {
      const path = window.location.pathname;
      const isHome = path.endsWith('index.html') || path === '/' || path === '';
      const href = this.getAttribute('href') || '';
      if (isHome && (href.endsWith('index.html') || href === '/' || href === '#')) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  // Hamburger menu toggle
  const hamburger = document.querySelector('.hamburger');
  const nav = document.querySelector('.nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', function() {
      this.classList.toggle('active');
      nav.classList.toggle('active');
    });
  }

  // Dropdown hover for desktop + click for mobile
  const dropdowns = document.querySelectorAll('.dropdown');
  let timeoutId;

  function dropdownClickHandler(e) {
    // Prevent closing if clicking inside dropdown content
    if (e.target.closest('.dropdown-content')) return;
    const dropdown = e.currentTarget;
    dropdown.classList.toggle('open');
  }

  function handleResize() {
    if (window.innerWidth > 768) {
      // Desktop: hover behavior
      dropdowns.forEach(dropdown => {
        dropdown.removeEventListener('click', dropdownClickHandler);
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
        dropdown.addEventListener('click', dropdownClickHandler);
      });
    }
  }

  // Initial call
  handleResize();
  window.addEventListener('resize', handleResize);

  // Showcase Drawers (Expandable Portfolio & Tech Stack)
  const drawerTriggers = document.querySelectorAll('.showcase-drawer-trigger');
  drawerTriggers.forEach(trigger => {
    trigger.addEventListener('click', function() {
      const drawer = this.closest('.showcase-drawer');
      if (!drawer) return;
      const isOpen = drawer.classList.contains('is-open');
      const label = this.querySelector('.toggle-label');
      const openText = this.getAttribute('data-open-text') || 'Close';
      const closedText = this.getAttribute('data-closed-text') || 'View';

      if (isOpen) {
        drawer.classList.remove('is-open');
        this.setAttribute('aria-expanded', 'false');
        if (label) label.textContent = closedText;
      } else {
        drawer.classList.add('is-open');
        this.setAttribute('aria-expanded', 'true');
        if (label) label.textContent = openText;
      }
    });
  });
});
