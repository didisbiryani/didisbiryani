window.showToast = (message, type = 'success') => {
    // Remove existing toast if any
    const existingToast = document.getElementById('custom-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Create container
    const toast = document.createElement('div');
    toast.id = 'custom-toast';
    
    // Style configurations
    const bgColors = {
        'success': 'bg-[#1a1a1a] border-green-500/50',
        'error': 'bg-[#1a1a1a] border-red-500/50',
        'info': 'bg-[#1a1a1a] border-brand-gold/50'
    };
    const iconColors = {
        'success': 'text-green-500',
        'error': 'text-red-500',
        'info': 'text-brand-gold'
    };
    const icons = {
        'success': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
        'error': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
        'info': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    // Build Toast HTML
    toast.className = `fixed top-6 right-1/2 translate-x-1/2 md:translate-x-0 md:right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl ${bgColors[type]} transform transition-all duration-300 translate-y-[-100%] opacity-0`;
    
    toast.innerHTML = `
        <div class="${iconColors[type]}">
            ${icons[type]}
        </div>
        <p class="text-sm font-bold text-white">${message}</p>
    `;

    document.body.appendChild(toast);

    // Animate In
    setTimeout(() => {
        toast.classList.remove('translate-y-[-100%]', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    }, 10);

    // Animate Out after 3 seconds
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-[-100%]', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};
