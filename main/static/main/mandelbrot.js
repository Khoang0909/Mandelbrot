class MandelbrotSet {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // Set initial canvas size to window size
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        this.maxIterations = 200;
        this.zoom = 0.8;
        this.centerX = -0.7;
        this.centerY = 0;
        
        // Store initial state for reset
        this.initialState = {
            zoom: 0.8,
            centerX: -0.7,
            centerY: 0
        };
        
        // Drag limits
        this.maxDragDistance = 4;
        this.minZoom = 0.1;
        this.maxZoom = 50;
        
        // Mouse drag state
        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartCenterX = 0;
        this.dragStartCenterY = 0;
        
        // Performance optimization
        this.isRendering = false;
        this.renderRequested = false;
        this.lastRenderTime = 0;
        this.targetFPS = 60; // Increased for smoother rendering
        this.frameInterval = 1000 / this.targetFPS;
        this.quality = 1;
        this.isZooming = false;
        this.zoomTimeout = null;
        this.renderTimeout = null;
        
        // Double buffering setup
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCtx = this.bufferCanvas.getContext('2d');
        this.bufferCanvas.width = this.width;
        this.bufferCanvas.height = this.height;
        
        // Loading state
        this.isInitialRender = true;
        this.initialRenderComplete = false;
        
        // Create Web Worker
        this.worker = new Worker(URL.createObjectURL(new Blob([`
            function mandelbrot(x, y, maxIterations) {
                let zx = 0;
                let zy = 0;
                let iterations = 0;

                while (zx * zx + zy * zy < 4 && iterations < maxIterations) {
                    const xtemp = zx * zx - zy * zy + x;
                    zy = 2 * zx * zy + y;
                    zx = xtemp;
                    iterations++;
                }

                return { iterations, lastZ: { x: zx, y: zy } };
            }

            function getColor(result, maxIterations) {
                const { iterations, lastZ } = result;
                
                if (iterations === maxIterations) {
                    return [0, 0, 0];
                }

                // Calculate smooth iteration count
                const smoothIter = iterations + 1 - Math.log2(Math.log2(lastZ.x * lastZ.x + lastZ.y * lastZ.y));
                const normalizedIter = Math.max(0, Math.min(1, smoothIter / maxIterations));

                // Create deep blue color scheme
                if (normalizedIter < 0.2) {
                    // Very close to set - darker
                    const intensity = Math.pow(normalizedIter / 0.2, 0.5);
                    return [0, 0, Math.round(intensity * 100)];
                } else if (normalizedIter < 0.8) {
                    // Transition zone - create glow effect
                    const intensity = (normalizedIter - 0.2) / 0.6;
                    const glow = Math.pow(1 - intensity, 2);
                    return [0, 0, Math.round(100 + (1 - glow) * 155)];
                } else {
                    // Outside set - bright blue
                    return [0, 0, 255];
                }
            }

            self.onmessage = function(e) {
                const { width, height, zoom, centerX, centerY, maxIterations, startY, endY, quality } = e.data;
                const imageData = new Uint8ClampedArray(width * (endY - startY) * 4);
                
                const step = 1 / quality;

                for (let y = startY; y < endY; y += step) {
                    for (let x = 0; x < width; x += step) {
                        const real = (x - width / 2) * (4 / width) / zoom + centerX;
                        const imag = (y - height / 2) * (4 / height) / zoom + centerY;

                        const result = mandelbrot(real, imag, maxIterations);
                        const color = getColor(result, maxIterations);

                        // Fill the pixels based on quality
                        for (let dy = 0; dy < step && y + dy < endY; dy++) {
                            for (let dx = 0; dx < step && x + dx < width; dx++) {
                                const pixelIndex = ((y + dy - startY) * width + (x + dx)) * 4;
                                imageData[pixelIndex] = color[0];
                                imageData[pixelIndex + 1] = color[1];
                                imageData[pixelIndex + 2] = color[2];
                                imageData[pixelIndex + 3] = 255;
                            }
                        }
                    }
                }

                self.postMessage({ imageData, startY, endY, quality });
            };
        `], { type: 'text/javascript' })));

        // Handle worker messages
        this.worker.onmessage = (e) => {
            const { imageData, startY, endY, quality } = e.data;
            
            // Draw to buffer first
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = this.width;
            tempCanvas.height = endY - startY;
            
            const tempImageData = tempCtx.createImageData(this.width, endY - startY);
            tempImageData.data.set(imageData);
            tempCtx.putImageData(tempImageData, 0, 0);
            
            // Draw to buffer
            this.bufferCtx.drawImage(tempCanvas, 0, startY);
            
            // Schedule a single render to main canvas
            if (!this.renderTimeout) {
                this.renderTimeout = requestAnimationFrame(() => {
                    this.ctx.drawImage(this.bufferCanvas, 0, 0);
                    this.renderTimeout = null;
                });
            }
            
            if (startY + (endY - startY) >= this.height) {
                this.isRendering = false;
                
                // Handle initial render completion
                if (this.isInitialRender && !this.initialRenderComplete) {
                    this.initialRenderComplete = true;
                    this.isInitialRender = false;
                    this.hideLoadingScreen();
                }
                
                if (quality < 1 && !this.isZooming) {
                    this.quality = 1;
                    this.render();
                } else if (this.renderRequested) {
                    this.renderRequested = false;
                    this.render();
                }
            }
        };

        // Set canvas size and handle window resizing
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Bind event listeners
        this.bindEvents();
        
        // Initial render
        this.render();

        // Audio setup
        this.music = new Audio('/static/main/audio/ethereal.mp3');
        this.music.loop = true;
        this.music.volume = 0.3;
        this.isMusicPlaying = false;
        
        // Initialize music controls
        this.initializeMusicControls();

        // Preloading setup
        this.preloadedImages = new Map();
        this.preloadZoomLevels = [0.8, 1.2, 1.6, 2.0, 2.5, 3.0, 3.5, 4.0];
        this.preloadPositions = [
            { x: -0.7, y: 0 },      // Center
            { x: -0.7, y: 0.2 },    // Up
            { x: -0.7, y: -0.2 },   // Down
            { x: -0.9, y: 0 },      // Left
            { x: -0.5, y: 0 },      // Right
            { x: -0.7, y: 0.1 },    // Up-Right
            { x: -0.7, y: -0.1 },   // Down-Right
            { x: -0.9, y: 0.1 },    // Up-Left
            { x: -0.9, y: -0.1 }    // Down-Left
        ];
        
        // Start preloading after initial render
        this.startPreloading();
    }

    initializeMusicControls() {
        this.musicButton = document.getElementById('toggleMusic');
        
        // Add click event listener for music toggle
        this.musicButton.addEventListener('click', () => {
            if (this.isMusicPlaying) {
                this.music.pause();
                this.musicButton.classList.remove('playing');
            } else {
                this.music.play().catch(error => {
                    console.error('Error playing audio:', error);
                });
                this.musicButton.classList.add('playing');
            }
            this.isMusicPlaying = !this.isMusicPlaying;
        });
        
        // Handle music loading
        this.music.addEventListener('canplaythrough', () => {
            console.log('Audio loaded and ready to play');
            this.musicButton.classList.add('loaded');
        });
        
        // Handle music errors
        this.music.addEventListener('error', (e) => {
            console.error('Error loading audio file:', e);
            this.musicButton.style.display = 'none';
        });
    }

    handleResize() {
        // Cancel any pending renders
        if (this.renderTimeout) {
            cancelAnimationFrame(this.renderTimeout);
            this.renderTimeout = null;
        }
        
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.bufferCanvas.width = this.width;
        this.bufferCanvas.height = this.height;
        this.render();
    }

    startPreloading() {
        // Create a queue of preload tasks
        const preloadQueue = [];
        
        // Generate preload tasks
        this.preloadZoomLevels.forEach(zoom => {
            this.preloadPositions.forEach(pos => {
                preloadQueue.push({ zoom, centerX: pos.x, centerY: pos.y });
            });
        });
        
        // Process preload queue
        this.processPreloadQueue(preloadQueue);
    }

    processPreloadQueue(queue, index = 0) {
        if (index >= queue.length) return;
        
        const { zoom, centerX, centerY } = queue[index];
        const key = `${zoom}-${centerX}-${centerY}`;
        
        // Skip if already preloaded
        if (this.preloadedImages.has(key)) {
            this.processPreloadQueue(queue, index + 1);
            return;
        }
        
        // Create temporary canvas for preloading
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = this.width;
        tempCanvas.height = this.height;
        
        // Create a one-time worker for preloading
        const preloadWorker = new Worker(URL.createObjectURL(new Blob([`
            function mandelbrot(x, y, maxIterations) {
                let zx = 0;
                let zy = 0;
                let iterations = 0;

                while (zx * zx + zy * zy < 4 && iterations < maxIterations) {
                    const xtemp = zx * zx - zy * zy + x;
                    zy = 2 * zx * zy + y;
                    zx = xtemp;
                    iterations++;
                }

                return { iterations, lastZ: { x: zx, y: zy } };
            }

            function getColor(result, maxIterations) {
                const { iterations, lastZ } = result;
                
                if (iterations === maxIterations) {
                    return [0, 0, 0];
                }

                const smoothIter = iterations + 1 - Math.log2(Math.log2(lastZ.x * lastZ.x + lastZ.y * lastZ.y));
                const normalizedIter = Math.max(0, Math.min(1, smoothIter / maxIterations));

                if (normalizedIter < 0.2) {
                    const intensity = Math.pow(normalizedIter / 0.2, 0.5);
                    return [0, 0, Math.round(intensity * 100)];
                } else if (normalizedIter < 0.8) {
                    const intensity = (normalizedIter - 0.2) / 0.6;
                    const glow = Math.pow(1 - intensity, 2);
                    return [0, 0, Math.round(100 + (1 - glow) * 155)];
                } else {
                    return [0, 0, 255];
                }
            }

            self.onmessage = function(e) {
                const { width, height, zoom, centerX, centerY, maxIterations } = e.data;
                const imageData = new Uint8ClampedArray(width * height * 4);
                
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const real = (x - width / 2) * (4 / width) / zoom + centerX;
                        const imag = (y - height / 2) * (4 / height) / zoom + centerY;

                        const result = mandelbrot(real, imag, maxIterations);
                        const color = getColor(result, maxIterations);

                        const pixelIndex = (y * width + x) * 4;
                        imageData[pixelIndex] = color[0];
                        imageData[pixelIndex + 1] = color[1];
                        imageData[pixelIndex + 2] = color[2];
                        imageData[pixelIndex + 3] = 255;
                    }
                }

                self.postMessage({ imageData });
            };
        `], { type: 'text/javascript' })));
        
        // Handle preload worker messages
        preloadWorker.onmessage = (e) => {
            const { imageData } = e.data;
            
            // Create ImageData and draw to temporary canvas
            const tempImageData = tempCtx.createImageData(this.width, this.height);
            tempImageData.data.set(imageData);
            tempCtx.putImageData(tempImageData, 0, 0);
            
            // Store preloaded image
            this.preloadedImages.set(key, tempCanvas);
            
            // Process next in queue
            this.processPreloadQueue(queue, index + 1);
        };
        
        // Start preloading
        preloadWorker.postMessage({
            width: this.width,
            height: this.height,
            zoom,
            centerX,
            centerY,
            maxIterations: this.maxIterations
        });
    }

    render() {
        const currentTime = performance.now();
        
        if (currentTime - this.lastRenderTime < this.frameInterval) {
            this.renderRequested = true;
            return;
        }
        
        if (this.isRendering) {
            this.renderRequested = true;
            return;
        }
        
        this.isRendering = true;
        this.lastRenderTime = currentTime;
        
        // Clear buffer
        this.bufferCtx.fillStyle = '#000';
        this.bufferCtx.fillRect(0, 0, this.width, this.height);
        
        // Check for preloaded image
        const key = `${this.zoom}-${this.centerX}-${this.centerY}`;
        const preloadedImage = this.preloadedImages.get(key);
        
        if (preloadedImage) {
            // Use preloaded image
            this.bufferCtx.drawImage(preloadedImage, 0, 0);
            this.ctx.drawImage(this.bufferCanvas, 0, 0);
            this.isRendering = false;
            return;
        }
        
        // If no preloaded image, render normally
        const chunkSize = Math.ceil(this.height / 4);
        
        for (let startY = 0; startY < this.height; startY += chunkSize) {
            const endY = Math.min(startY + chunkSize, this.height);
            this.worker.postMessage({
                width: this.width,
                height: this.height,
                zoom: this.zoom,
                centerX: this.centerX,
                centerY: this.centerY,
                maxIterations: this.maxIterations,
                startY,
                endY,
                quality: this.quality
            });
        }
    }

    bindEvents() {
        // Mouse drag handling
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartCenterX = this.centerX;
            this.dragStartCenterY = this.centerY;
            this.canvas.style.cursor = 'grabbing';
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastX;
                const dy = e.clientY - this.lastY;
                
                this.centerX -= dx * (4 / this.width) / this.zoom;
                this.centerY -= dy * (4 / this.height) / this.zoom;
                
                this.lastX = e.clientX;
                this.lastY = e.clientY;
                
                this.quality = 0.5;
                this.render();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.canvas.style.cursor = 'grab';
                this.quality = 1;
                this.render();
            }
        });

        // Zoom with mouse wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const pointX = (mouseX - this.width / 2) * (4 / this.width) / this.zoom + this.centerX;
            const pointY = (mouseY - this.height / 2) * (4 / this.height) / this.zoom + this.centerY;
            
            this.isZooming = true;
            this.quality = 0.25;
            
            const zoomFactor = e.deltaY < 0 ? 1.1 : 1/1.1;
            const newZoom = Math.min(Math.max(this.zoom * zoomFactor, this.minZoom), this.maxZoom);
            
            if (newZoom !== this.zoom) {
                this.centerX = pointX - (pointX - this.centerX) * (this.zoom / newZoom);
                this.centerY = pointY - (pointY - this.centerY) * (this.zoom / newZoom);
                this.zoom = newZoom;
            }
            
            if (this.zoomTimeout) {
                clearTimeout(this.zoomTimeout);
            }
            
            this.zoomTimeout = setTimeout(() => {
                this.isZooming = false;
                this.quality = 1;
                this.render();
            }, 150);
            
            this.render();
        });

        // Button controls
        document.getElementById('zoomIn').addEventListener('click', () => {
            const newZoom = Math.min(this.zoom * 1.5, this.maxZoom);
            if (newZoom !== this.zoom) {
                this.zoom = newZoom;
                this.render();
            }
        });

        document.getElementById('zoomOut').addEventListener('click', () => {
            const newZoom = Math.max(this.zoom / 1.5, this.minZoom);
            if (newZoom !== this.zoom) {
                this.zoom = newZoom;
                this.render();
            }
        });

        document.getElementById('reset').addEventListener('click', () => {
            this.zoom = this.initialState.zoom;
            this.centerX = this.initialState.centerX;
            this.centerY = this.initialState.centerY;
            this.render();
        });
    }

    hideLoadingScreen() {
        // Fade out loading screen
        const loadingScreen = document.getElementById('loadingScreen');
        loadingScreen.classList.add('hidden');
        
        // Fade in canvas and controls
        this.canvas.classList.add('loaded');
        document.querySelector('.controls').classList.add('loaded');
        
        // Remove loading screen after animation
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    }
}

// Initialize when the window loads
window.addEventListener('load', () => {
    const canvas = document.getElementById('mandelbrotCanvas');
    new MandelbrotSet(canvas);
});