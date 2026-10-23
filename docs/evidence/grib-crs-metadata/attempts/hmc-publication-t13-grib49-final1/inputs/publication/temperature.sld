<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">
  <NamedLayer><Name>temperature</Name><UserStyle><Name>raster</Name>
    <Title>Температура поверхности, K</Title><FeatureTypeStyle><Rule><RasterSymbolizer>
      <Opacity>1</Opacity><ChannelSelection><GrayChannel><SourceChannelName>1</SourceChannelName></GrayChannel></ChannelSelection>
      <ColorMap type="ramp">
        <ColorMapEntry color="#313695" quantity="240" label="240 K"/>
        <ColorMapEntry color="#74add1" quantity="260" label="260 K"/>
        <ColorMapEntry color="#ffffbf" quantity="280" label="280 K"/>
        <ColorMapEntry color="#f46d43" quantity="300" label="300 K"/>
        <ColorMapEntry color="#a50026" quantity="320" label="320 K"/>
      </ColorMap>
    </RasterSymbolizer></Rule></FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>
