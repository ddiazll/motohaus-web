(function(){
  var capas=[].slice.call(document.querySelectorAll('.fondo-capa'));
  if(!capas.length)return;
  var reducir=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pendiente=false;
  function actualizar(){
    pendiente=false;
    var max=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
    var p=Math.min(1,Math.max(0,window.scrollY/max));
    var pos=p*(capas.length-1);
    capas.forEach(function(c,i){
      var o=Math.max(0,1-Math.abs(pos-i));
      c.style.opacity=o;
      if(!reducir)c.style.transform='scale('+(1.06+0.06*(pos-i))+') translateY('+((pos-i)*-14)+'px)';
    });
  }
  function pedir(){if(!pendiente){pendiente=true;requestAnimationFrame(actualizar);}}
  window.addEventListener('scroll',pedir,{passive:true});
  window.addEventListener('resize',pedir);
  actualizar();
})();
