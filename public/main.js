// /public/main.js
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('img[data-placeholder]').forEach(img => {
        const fallback = img.getAttribute('data-placeholder');
        img.addEventListener('error', () => {
            img.onerror = null;
            img.src = fallback;
        });
    });
});
