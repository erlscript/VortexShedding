//used a lot of ideas from https://bl.ocks.org/robinhouston/ed597847175cf692ecce to clean this code up

var width, height;

var lastMouseCoordinates =  [0,0];
var mouseCoordinates =  [0,0];
var mouseEnable = false;

var paused = false;//while window is resizing

var dt = 1;
var dx = 1;
var nu = 1;//viscosity
var rho = 1;//density

var GPU;

window.onload = initGL;

function initGL() {

    $("#about").click(function(e){
        e.preventDefault();
        $("#aboutModal").modal('show');
    });

    canvas = document.getElementById("glcanvas");

    canvas.onmousemove = onMouseMove;
    canvas.onmousedown = onMouseDown;
    canvas.onmouseup = onMouseUp;
    canvas.onmouseout = onMouseUp;

    window.onresize = onResize;

    GPU = initGPUMath();

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    width = canvas.clientWidth;
    height = canvas.clientHeight;

    // setup a GLSL programs
    GPU.createProgram("advect", "2d-vertex-shader", "advectShader");
    GPU.setUniformForProgram("advect", "u_dt", dt, "1f");
    GPU.setUniformForProgram("advect", "u_velocity", 0, "1i");
    GPU.setUniformForProgram("advect", "u_material", 1, "1i");

    GPU.createProgram("gradientSubtraction", "2d-vertex-shader", "gradientSubtractionShader");
    GPU.setUniformForProgram("gradientSubtraction", "u_const", 0.5/dx, "1f");//dt/(2*rho*dx)
    GPU.setUniformForProgram("gradientSubtraction", "u_velocity", 0, "1i");
    GPU.setUniformForProgram("gradientSubtraction", "u_pressure", 1, "1i");

    GPU.createProgram("diverge", "2d-vertex-shader", "divergenceShader");
    GPU.setUniformForProgram("diverge", "u_const", 0.5/dx, "1f");//-2*dx*rho/dt
    GPU.setUniformForProgram("diverge", "u_velocity", 0, "1i");

    GPU.createProgram("force", "2d-vertex-shader", "forceShader");
    GPU.setUniformForProgram("force", "u_dt", dt, "1f");
    GPU.setUniformForProgram("force", "u_velocity", 0, "1i");

    GPU.createProgram("jacobi", "2d-vertex-shader", "jacobiShader");
    GPU.setUniformForProgram("jacobi", "u_b", 0, "1i");
    GPU.setUniformForProgram("jacobi", "u_x", 1, "1i");

    GPU.createProgram("render", "2d-vertex-shader", "2d-render-shader");
    GPU.setUniformForProgram("render", "u_material", 0, "1i");

    resetWindow();

    render();
}

function render(){

    if (!paused) {

        //advect velocity
        GPU.step("advect", ["velocity", "velocity"], "nextVelocity");
        GPU.swapTextures("velocity", "nextVelocity");

        //diffuse velocity
        GPU.setProgram("jacobi");
        var alpha = dx*dx/(nu*dt);
        GPU.setUniformForProgram("jacobi", "u_alpha", alpha, "1f");
        GPU.setUniformForProgram("jacobi", "u_reciprocalBeta", 1/(4+alpha), "1f");
        for (var i=0;i<3;i++){
            GPU.step("jacobi", ["velocity", "velocity"], "nextVelocity");
            GPU.step("jacobi", ["nextVelocity", "nextVelocity"], "velocity");
        }

        //apply force
        GPU.setProgram("force");
        if (mouseEnable){
            GPU.setUniformForProgram("force", "u_mouseEnable", 1.0, "1f");
            GPU.setUniformForProgram("force", "u_mouseCoord", [mouseCoordinates[0], mouseCoordinates[1]], "2f");
            GPU.setUniformForProgram("force", "u_mouseDir", [mouseCoordinates[0]-lastMouseCoordinates[0],
                mouseCoordinates[1]-lastMouseCoordinates[1]], "2f");
        } else {
            GPU.setUniformForProgram("force", "u_mouseEnable", 0.0, "1f");
        }
        GPU.step("force", ["velocity"], "nextVelocity");
        GPU.swapTextures("velocity", "nextVelocity");

        // compute pressure
        GPU.step("diverge", ["velocity"], "velocityDivergence");//calc velocity divergence
        GPU.setProgram("jacobi");
        GPU.setUniformForProgram("jacobi", "u_alpha", -dx*dx, "1f");
        GPU.setUniformForProgram("jacobi", "u_reciprocalBeta", 1/4, "1f");
        for (var i=0;i<20;i++){
            GPU.step("jacobi", ["velocityDivergence", "pressure"], "nextPressure");//diffuse velocity
            GPU.step("jacobi", ["velocityDivergence", "nextPressure"], "pressure");//diffuse velocity
        }

        // subtract pressure gradient
        GPU.step("gradientSubtraction", ["velocity", "pressure"], "nextVelocity");
        GPU.swapTextures("velocity", "nextVelocity");

        // GPU.step("diffuse", ["material"], "nextMaterial");
        GPU.step("advect", ["velocity", "material"], "nextMaterial");
        GPU.step("render", ["nextMaterial"]);
        GPU.swapTextures("nextMaterial", "material");

    } else resetWindow();

    window.requestAnimationFrame(render);
}

function onResize(){
    paused = true;
}

function resetWindow(){
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    width = canvas.clientWidth;
    height = canvas.clientHeight;

    GPU.setSize(width, height);

    GPU.setProgram("advect");
    GPU.setUniformForProgram("advect" ,"u_textureSize", [width, height], "2f");
    GPU.setProgram("gradientSubtraction");
    GPU.setUniformForProgram("gradientSubtraction" ,"u_textureSize", [width, height], "2f");
    GPU.setProgram("diverge");
    GPU.setUniformForProgram("diverge" ,"u_textureSize", [width, height], "2f");
    GPU.setProgram("force");
    GPU.setUniformForProgram("force" ,"u_textureSize", [width, height], "2f");
    GPU.setProgram("jacobi");
    GPU.setUniformForProgram("jacobi" ,"u_textureSize", [width, height], "2f");
    GPU.setProgram("render");
    GPU.setUniformForProgram("render" ,"u_textureSize", [width, height], "2f");

    var velocity = new Float32Array(width*height*4);
    // for (var i=0;i<height;i++){
    //     for (var j=0;j<width;j++){
    //         var index = 4*(i*width+j);
    //         velocity[index] = Math.sin(2*Math.PI*i/200)/10;
    //         velocity[index+1] = Math.sin(2*Math.PI*j/200)/10;
    //     }
    // }
    GPU.initTextureFromData("velocity", width, height, "FLOAT", velocity, true);
    GPU.initFrameBufferForTexture("velocity", true);
    GPU.initTextureFromData("nextVelocity", width, height, "FLOAT", new Float32Array(width*height*4), true);
    GPU.initFrameBufferForTexture("nextVelocity", true);

    GPU.initTextureFromData("velocityDivergence", width, height, "FLOAT", new Float32Array(width*height*4), true);
    GPU.initFrameBufferForTexture("velocityDivergence", true);
    GPU.initTextureFromData("pressure", width, height, "FLOAT", new Float32Array(width*height*4), true);
    GPU.initFrameBufferForTexture("pressure", true);
    GPU.initTextureFromData("nextPressure", width, height, "FLOAT", new Float32Array(width*height*4), true);
    GPU.initFrameBufferForTexture("nextPressure", true);

    var material = new Float32Array(width*height*4);
    for (var i=0;i<height;i++){
        for (var j=0;j<width;j++){
            var index = 4*(i*width+j);
            if (((Math.floor(i/50))%2 && (Math.floor(j/50))%2)
                || ((Math.floor(i/50))%2 == 0 && (Math.floor(j/50))%2 == 0)) material[index] = 1.0;
        }
    }
    GPU.initTextureFromData("material", width, height, "FLOAT", material, true);
    GPU.initFrameBufferForTexture("material", true);
    GPU.initTextureFromData("nextMaterial", width, height, "FLOAT", material, true);
    GPU.initFrameBufferForTexture("nextMaterial", true);

    paused = false;
}

function onMouseMove(e){
    lastMouseCoordinates = mouseCoordinates;
    mouseCoordinates = [e.clientX, height-e.clientY];
}

function onMouseDown(){
    mouseEnable = true;
}

function onMouseUp(){
    mouseEnable = false;
}